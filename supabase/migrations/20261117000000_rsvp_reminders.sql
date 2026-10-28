-- "Are you playing?" reminder emails (Pro, "rsvp").
--
-- The commissioner picks how many days before league night (or off). Once an
-- hour a database timer calls the send-reminders server function, which emails
-- golfers who haven't answered at 9 AM league time on that day. Each email has
-- one-tap "I'm in" / "I'm out" links that work without signing in (a private
-- link per golfer per week), and a link to stop these reminders.

-- Days before league night (1–6); null: no reminder emails.
alter table leagues add column rsvp_reminder_days smallint check (rsvp_reminder_days between 1 and 6);
grant update (rsvp_reminder_days) on leagues to authenticated;

-- Weeks already reminded (written by the server function).
create table reminder_sends (
  event_id uuid primary key,
  league_id uuid not null,
  sent_at timestamptz not null default now(),
  recipients int not null default 0,
  foreign key (league_id, event_id) references events (league_id, id) on delete cascade
);
alter table reminder_sends enable row level security;
create policy "commissioners read reminder sends" on reminder_sends for select using (is_commissioner(league_id));
revoke insert, update, delete on reminder_sends from anon, authenticated;

-- One-tap answer links: sha256 of the token in the link; the raw token is never stored.
create table rsvp_links (
  token_hash text primary key,
  event_id uuid not null,
  player_id uuid not null,
  league_id uuid not null,
  created_at timestamptz not null default now(),
  unique (event_id, player_id),
  foreign key (league_id, event_id) references events (league_id, id) on delete cascade,
  foreign key (league_id, player_id) references players (league_id, id) on delete cascade
);
alter table rsvp_links enable row level security;
revoke all on rsvp_links from anon, authenticated;

-- Answer from the email without signing in. p_status: 'in', 'out', 'stop'
-- (no more reminder emails), or null to just see the week. Returns what the
-- answer page shows, or null for a link that isn't valid (any more).
create function rsvp_by_link(p_token text, p_status text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k rsvp_links;
  ev events;
  lg leagues;
  pl players;
  st text;
begin
  select * into k from rsvp_links where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  if k.token_hash is null then return null; end if;
  select * into ev from events where id = k.event_id;
  select * into lg from leagues where id = k.league_id;
  select * into pl from players where id = k.player_id;
  if p_status is not null and p_status not in ('in', 'out', 'stop') then raise exception 'Unknown answer.'; end if;

  if p_status = 'stop' then
    insert into notification_prefs (player_id, league_id, rsvp_reminders) values (pl.id, lg.id, false)
    on conflict (player_id) do update set rsvp_reminders = false, updated_at = now();
  elsif p_status is not null then
    if ev.status <> 'scheduled' then raise exception 'This week has already started.'; end if;
    if not league_has_feature(lg.id, 'rsvp') then raise exception 'RSVPs are off for this league.'; end if;
    -- Saying you're out takes you off the tee sheet too.
    if p_status = 'out' then perform lineup_clear(ev.id, pl.id); end if;
    insert into event_rsvps (event_id, player_id, league_id, status, responded_by)
    values (ev.id, pl.id, lg.id, p_status, null)
    on conflict (event_id, player_id) do update set status = excluded.status, responded_by = null, responded_at = now();
  end if;

  select status into st from event_rsvps where event_id = ev.id and player_id = pl.id;
  return jsonb_build_object(
    'leagueName', lg.name, 'leagueSlug', lg.slug, 'eventId', ev.id, 'weekNumber', ev.week_number, 'eventDate', ev.event_date,
    'playerName', pl.display_name, 'status', st, 'open', ev.status = 'scheduled',
    'remindersOff', exists (select 1 from notification_prefs where player_id = pl.id and rsvp_reminders = false));
end $$;
grant execute on function rsvp_by_link(text, text) to anon, authenticated;

-- The hourly timer proves itself to the server function with this secret,
-- which only the database and the function (with the service key) can read.
create table cron_secret (
  id boolean primary key default true check (id),
  token text not null
);
alter table cron_secret enable row level security;
revoke all on cron_secret from anon, authenticated;
insert into cron_secret (token) values (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

-- Hourly timer (Supabase only: pg_cron and pg_net aren't in local test databases).
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    return;
  end if;
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  perform cron.schedule('send-reminders', '5 * * * *', $job$
    select net.http_post(
      url := 'https://foxthtwxgfnoqxrcbxfc.supabase.co/functions/v1/send-reminders',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select token from public.cron_secret)),
      body := '{}'::jsonb
    )
  $job$);
end $$;
