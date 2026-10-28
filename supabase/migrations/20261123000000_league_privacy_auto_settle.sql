-- Three league settings from the old OCBC app, and the week settling itself.
--
--   show_money   golfers see season money (Standings, player pages, awards, the
--                recap's "season to date" line). Commissioners always do. Week
--                results still show that week's money.
--   share_emails golfers can see each other's emails on the roster (phones have
--                their own switch, share_phones). Commissioners always can.
--   auto_settle  the week settles itself once every group on the tee sheet has
--                submitted (the old app did it at 9 groups). Weeks without a tee
--                sheet, and weeks with a closest-to-the-pin hole two groups both
--                claimed, wait for the commissioner.
--
-- Settling itself: the last group's submit queues the week; the database calls
-- the auto-settle server function (with the hourly timer's secret), which works
-- the money out with the same scoring engine as the Settle button and posts it.

alter table leagues
  add column show_money boolean not null default true,
  add column share_emails boolean not null default false,
  add column auto_settle boolean not null default true;
grant update (show_money, share_emails, auto_settle) on leagues to authenticated;

create function league_email_book(lid uuid) returns table (player_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select c.player_id, c.email
  from player_contacts c
  join players p on p.id = c.player_id
  join leagues l on l.id = c.league_id
  where c.league_id = lid and c.email is not null and p.active
    and (is_commissioner(lid) or (l.share_emails and is_league_member(lid)))
$$;
grant execute on function league_email_book(uuid) to authenticated;
revoke execute on function league_email_book(uuid) from anon, public;

-- ── Posting a settlement ─────────────────────────────────────────────────────

-- What settle_event did after checking the caller: check the entries and post them.
create function post_settlement(p_event uuid, p_entries jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  ev events;
  n integer;
begin
  select * into ev from events where id = p_event for update;
  if ev.id is null then raise exception 'no such week'; end if;
  if jsonb_typeof(p_entries) <> 'array' then raise exception 'entries must be a list'; end if;

  if jsonb_array_length(p_entries) > 0 and not league_has_feature(ev.league_id, 'side_games') then
    raise exception 'plan_feature: Side games and money needs GolfScoreHQ Pro' using errcode = 'P0001';
  end if;

  -- Every entry must be for a golfer who played in this week, in a group from this week.
  if exists (
    select 1 from jsonb_to_recordset(p_entries) as e(player_id uuid, round_id uuid, kind text, amount_cents integer, hole_number smallint)
    where e.kind not in ('match', 'press', 'skin', 'ctp', 'scramblePot', 'place')
       or e.amount_cents is null
       or not exists (
         select 1 from round_players rp join rounds r on r.id = rp.round_id
         where r.event_id = p_event and rp.player_id = e.player_id
           and (e.round_id is null or r.id = e.round_id)
       )
  ) then
    raise exception 'settlement includes a golfer or group that is not in this week';
  end if;

  delete from ledger_entries where event_id = p_event;
  insert into ledger_entries (league_id, event_id, round_id, player_id, kind, amount_cents, hole_number)
  select ev.league_id, p_event, e.round_id, e.player_id, e.kind, e.amount_cents, e.hole_number
  from jsonb_to_recordset(p_entries) as e(player_id uuid, round_id uuid, kind text, amount_cents integer, hole_number smallint);
  get diagnostics n = row_count;

  update events set status = 'settled', settled_at = now() where id = p_event;
  return n;
end $$;

create or replace function settle_event(p_event uuid, p_entries jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  lg uuid;
begin
  select league_id into lg from events where id = p_event;
  if lg is null then raise exception 'no such week'; end if;
  if not is_commissioner(lg) then raise exception 'commissioners only'; end if;
  return post_settlement(p_event, p_entries);
end $$;

-- ── Settling itself ──────────────────────────────────────────────────────────

-- Every group on the tee sheet has a submitted round, and nobody is still scoring.
create function event_ready_to_settle(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select e.status in ('scheduled', 'in_progress') and l.auto_settle
      and exists (select 1 from rounds where event_id = p_event)
      and not exists (select 1 from rounds where event_id = p_event and status <> 'submitted')
      and (select count(distinct slot) from event_lineup where event_id = p_event and slot is not null) > 0
      and (select count(*) from rounds where event_id = p_event)
          >= (select count(distinct slot) from event_lineup where event_id = p_event and slot is not null)
    from events e join leagues l on l.id = e.league_id
    where e.id = p_event
  ), false)
$$;

create table settle_queue (
  event_id uuid primary key references events (id) on delete cascade,
  queued_at timestamptz not null default now()
);
alter table settle_queue enable row level security;
revoke all on settle_queue from anon, authenticated;

create function round_submitted_settle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted' and event_ready_to_settle(new.event_id) then
    insert into settle_queue (event_id) values (new.event_id) on conflict do nothing;
  end if;
  return null;
end $$;
create trigger round_submitted_settle after update of status on rounds
  for each row execute function round_submitted_settle();

-- A queued week wakes the auto-settle function (Supabase only: pg_net isn't in local test databases).
create function settle_queue_send() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if to_regnamespace('net') is null then return null; end if;
  perform net.http_post(
    url := 'https://foxthtwxgfnoqxrcbxfc.supabase.co/functions/v1/auto-settle',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select token from cron_secret)),
    body := '{}'::jsonb
  );
  return null;
end $$;
create trigger settle_queue_send after insert on settle_queue for each statement execute function settle_queue_send();

-- The server function takes the waiting weeks (each once).
create function take_settle_queue() returns setof uuid
language sql security definer set search_path = public as $$
  delete from settle_queue
  where event_id in (select event_id from settle_queue order by queued_at limit 50 for update skip locked)
  returning event_id
$$;

-- The server function posts the money it worked out, if the week is still ready.
create function auto_settle_event(p_event uuid, p_entries jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  ev events;
  commish uuid[];
begin
  select * into ev from events where id = p_event for update;
  if ev.id is null or not event_ready_to_settle(p_event) then return false; end if;
  perform post_settlement(p_event, p_entries);
  select coalesce(array_agg(user_id), '{}') into commish from league_members where league_id = ev.league_id and role in ('owner', 'commissioner');
  perform queue_push(commish, 'Week ' || ev.week_number || ' is settled',
    'Every group is in, so the results and money are posted. Reopen the week if a score needs fixing.', week_url(p_event), 'settled-' || p_event);
  return true;
end $$;

-- Every group is in but a closest-to-the-pin hole needs the commissioner.
create function auto_settle_waiting(p_event uuid, p_holes int[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  ev events;
  commish uuid[];
begin
  select * into ev from events where id = p_event;
  if ev.id is null then return; end if;
  select coalesce(array_agg(user_id), '{}') into commish from league_members where league_id = ev.league_id and role in ('owner', 'commissioner');
  perform queue_push(commish, 'Week ' || ev.week_number || ': every group is in',
    'Two groups claimed closest to the pin on hole ' || array_to_string(p_holes, ', ') || '. Pick the winner, then settle the week.',
    week_url(p_event), 'settled-' || p_event);
end $$;

revoke execute on function post_settlement(uuid, jsonb), event_ready_to_settle(uuid), round_submitted_settle(), settle_queue_send(),
  take_settle_queue(), auto_settle_event(uuid, jsonb), auto_settle_waiting(uuid, int[])
  from anon, authenticated, public;
grant execute on function event_ready_to_settle(uuid), take_settle_queue(), auto_settle_event(uuid, jsonb), auto_settle_waiting(uuid, int[]) to service_role;
