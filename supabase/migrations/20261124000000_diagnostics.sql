-- Diagnostics: knowing about problems before golfers tell us, and adding capacity before it runs out.
--
--   app_errors        crashes and failed actions the app reports by itself, and
--                     "Report a problem" notes from golfers. Grouped by a fingerprint
--                     (the message with numbers and ids taken out) so one bug is one line.
--   app_presence      who has the app open (a heartbeat every 2 minutes while it's on screen).
--   capacity_samples  every 5 minutes: how many people had the app open, how many groups were scoring.
--   capacity_limits   the plan limits we compare against (staff change them when upgrading).
--
-- Staff read it all on /staff (staff_health), and a daily timer calls the
-- health-report server function, which emails support when something needs a look.

create table app_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('error', 'failed_action', 'report')),
  message text not null,
  detail text,
  path text,
  app_version text,
  user_agent text,
  user_id uuid references auth.users (id) on delete set null,
  league_id uuid references leagues (id) on delete set null,
  fingerprint text not null,
  resolved_at timestamptz
);
create index on app_errors (created_at desc);
create index on app_errors (fingerprint, created_at desc);
alter table app_errors enable row level security;
revoke all on app_errors from anon, authenticated;

-- "Couldn't load week 3a1b…: 504" and "…week 9f2c…: 504" are the same problem.
create function error_fingerprint(p_kind text, p_message text) returns text
language sql immutable as $$
  select md5(p_kind || ':' || regexp_replace(lower(coalesce(p_message, '')), '[0-9a-f]{8}-[0-9a-f-]{27}|[0-9]+', '#', 'g'))
$$;

-- The app reports a problem (anyone, signed in or not). Limited so a broken
-- phone in a loop can't flood it: 30 an hour per person, 300 an hour from people not signed in.
create function log_app_error(p_kind text, p_message text, p_detail text default null, p_path text default null,
  p_version text default null, p_user_agent text default null, p_league_slug text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  lg uuid;
begin
  if p_kind not in ('error', 'failed_action', 'report') or coalesce(trim(p_message), '') = '' then return; end if;
  if me is not null then
    if (select count(*) from app_errors where user_id = me and created_at > now() - interval '1 hour') >= 30 then return; end if;
  elsif (select count(*) from app_errors where user_id is null and created_at > now() - interval '1 hour') >= 300 then
    return;
  end if;
  if p_league_slug is not null then select id into lg from leagues where slug = p_league_slug; end if;
  insert into app_errors (kind, message, detail, path, app_version, user_agent, user_id, league_id, fingerprint)
  values (p_kind, left(trim(p_message), 500), left(p_detail, 4000), left(p_path, 300), left(p_version, 40), left(p_user_agent, 300),
          me, lg, error_fingerprint(p_kind, p_message));
end $$;
grant execute on function log_app_error(text, text, text, text, text, text, text) to anon, authenticated;

-- ── Capacity ─────────────────────────────────────────────────────────────────

create table app_presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_seen timestamptz not null default now()
);
alter table app_presence enable row level security;
revoke all on app_presence from anon, authenticated;

create function app_heartbeat() returns void
language sql security definer set search_path = public as $$
  insert into app_presence (user_id, last_seen) select auth.uid(), now() where auth.uid() is not null
  on conflict (user_id) do update set last_seen = now()
$$;
grant execute on function app_heartbeat() to authenticated;

create table capacity_samples (
  taken_at timestamptz primary key default now(),
  online int not null,
  live_rounds int not null
);
alter table capacity_samples enable row level security;
revoke all on capacity_samples from anon, authenticated;

create function take_capacity_sample() returns void
language sql security definer set search_path = public as $$
  insert into capacity_samples (online, live_rounds)
  select (select count(*) from app_presence where last_seen > now() - interval '3 minutes'),
         (select count(*) from rounds where status = 'live' and updated_at > now() - interval '30 minutes');
  delete from capacity_samples where taken_at < now() - interval '120 days';
  delete from app_errors where created_at < now() - interval '180 days';
$$;

create table capacity_limits (
  key text primary key,
  label text not null,
  value numeric not null check (value > 0)
);
alter table capacity_limits enable row level security;
revoke all on capacity_limits from anon, authenticated;
-- Today's free plans. Raise them when upgrading (Supabase Pro: 500 online, 8000 MB; Resend Pro: no daily cap, 50,000 a month).
insert into capacity_limits (key, label, value) values
  ('online', 'People with the app open at once (Supabase live connections)', 200),
  ('emails_day', 'Emails a day (Resend)', 100),
  ('emails_month', 'Emails a month (Resend)', 3000),
  ('db_mb', 'Database size, MB (Supabase)', 500);

-- ── What staff see ───────────────────────────────────────────────────────────

-- Everything on the health page and in the daily email. p_days: how far back errors go.
create function health_snapshot(p_days int default 7) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  errors jsonb;
  jobs jsonb := '[]';
  calls jsonb := '[]';
  usage jsonb;
  limits jsonb;
begin
  select coalesce(jsonb_agg(g order by g.last_seen desc), '[]') into errors from (
    select e.fingerprint, min(e.kind) as kind, count(*) as count, count(distinct e.user_id) as people,
           min(e.created_at) as first_seen, max(e.created_at) as last_seen,
           bool_and(e.resolved_at is not null) as resolved,
           (array_agg(e.message order by e.created_at desc))[1] as message,
           (array_agg(e.detail order by e.created_at desc))[1] as detail,
           (array_agg(e.path order by e.created_at desc))[1] as path,
           (array_agg(e.app_version order by e.created_at desc))[1] as app_version,
           (array_agg(e.user_agent order by e.created_at desc))[1] as user_agent,
           (array_agg(l.name order by e.created_at desc) filter (where l.name is not null))[1] as league,
           (array_agg(u.email order by e.created_at desc) filter (where e.kind = 'report'))[1] as reported_by
    from app_errors e
    left join leagues l on l.id = e.league_id
    left join auth.users u on u.id = e.user_id
    where e.created_at > now() - make_interval(days => p_days)
    group by e.fingerprint
    limit 200
  ) g;

  -- Timers that failed (Supabase only).
  if to_regclass('cron.job_run_details') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('job', j.jobname, 'at', d.start_time, 'message', left(d.return_message, 300)) order by d.start_time desc), '[]')
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
      where d.status = 'failed' and d.start_time > now() - interval '1 day'
    $q$ into jobs;
  end if;
  -- Calls the database made to the server functions that didn't work (Supabase only).
  if to_regclass('net._http_response') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('at', created, 'status', status_code, 'message', left(coalesce(error_msg, content::text), 300)) order by created desc), '[]')
      from (select * from net._http_response
            where created > now() - interval '1 day' and (status_code >= 400 or error_msg is not null or timed_out)
            order by created desc limit 50) r
    $q$ into calls;
  end if;

  select jsonb_build_object(
    'online_now', (select count(*) from app_presence where last_seen > now() - interval '3 minutes'),
    'online_peak_day', (select coalesce(max(online), 0) from capacity_samples where taken_at > now() - interval '1 day'),
    'online_peak_week', (select coalesce(max(online), 0) from capacity_samples where taken_at > now() - interval '7 days'),
    'online_peak_month', (select coalesce(max(online), 0) from capacity_samples where taken_at > now() - interval '30 days'),
    'live_rounds_peak_week', (select coalesce(max(live_rounds), 0) from capacity_samples where taken_at > now() - interval '7 days'),
    'emails_day', (select coalesce(sum(recipients), 0) from (
        select recipients from reminder_sends where sent_at > now() - interval '1 day'
        union all select recipients from recap_sends where sent_at > now() - interval '1 day') s),
    'emails_month', (select coalesce(sum(recipients), 0) from (
        select recipients from reminder_sends where sent_at > date_trunc('month', now())
        union all select recipients from recap_sends where sent_at > date_trunc('month', now())) s),
    'db_mb', round(pg_database_size(current_database()) / 1048576.0),
    'leagues', (select count(*) from leagues),
    'active_leagues', (select count(distinct league_id) from rounds where updated_at > now() - interval '14 days'),
    'golfers', (select count(*) from players where active),
    'app_users', (select count(*) from players where user_id is not null and active),
    'devices_with_notifications', (select count(*) from push_subscriptions)
  ) into usage;

  select coalesce(jsonb_object_agg(key, jsonb_build_object('label', label, 'value', value)), '{}') into limits from capacity_limits;

  return jsonb_build_object('errors', errors, 'failed_jobs', jobs, 'failed_calls', calls, 'usage', usage, 'limits', limits, 'at', now());
end $$;

create function staff_health(p_days int default 7) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return health_snapshot(least(greatest(p_days, 1), 90));
end $$;

-- Mark a problem fixed; if it happens again it shows up as new.
create function staff_resolve_error(p_fingerprint text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  update app_errors set resolved_at = now() where fingerprint = p_fingerprint and resolved_at is null;
end $$;

create function staff_set_limit(p_key text, p_value numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if p_value is null or p_value <= 0 then raise exception 'Enter a number above 0.'; end if;
  update capacity_limits set value = p_value where key = p_key;
end $$;

grant execute on function staff_health(int), staff_resolve_error(text), staff_set_limit(text, numeric) to authenticated;
revoke execute on function staff_health(int), staff_resolve_error(text), staff_set_limit(text, numeric) from anon, public;
revoke execute on function health_snapshot(int), take_capacity_sample(), error_fingerprint(text, text) from anon, authenticated, public;
grant execute on function health_snapshot(int) to service_role;

-- Timers (Supabase only: pg_cron and pg_net aren't in local test databases).
--   every 5 minutes: count who's online
--   daily at 12:00 UTC (8 AM Eastern): the health-report email
do $$
begin
  if to_regnamespace('cron') is null or to_regnamespace('net') is null then return; end if;
  perform cron.schedule('capacity-sample', '*/5 * * * *', 'select public.take_capacity_sample()');
  perform cron.schedule('health-report', '0 12 * * *', $job$
    select net.http_post(
      url := 'https://foxthtwxgfnoqxrcbxfc.supabase.co/functions/v1/health-report',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select token from public.cron_secret)),
      body := '{}'::jsonb
    )
  $job$);
end $$;
