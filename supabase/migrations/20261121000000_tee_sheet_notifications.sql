-- Phone notifications for the tee sheet and the sub finder.
--
-- The database decides who to tell and what to say, and drops it in an
-- outbox; each new message makes the database call the push server function
-- (with the hourly timer's secret), which sends it to everyone's phones.
-- Nobody is told about something they did themselves.
--
--   A captain gives up a tee time   → the golfers in that group, and the commissioners
--   A group moves to another time   → its golfers ("your group is now T2 at 5:17 PM")
--   Someone puts you in a group      → you ("Tony put you in T3 at 5:24 PM" / "you're captain of T1")
--   Someone teams up with you        → you ("Ben teamed up with you: you two need a match")
--   A sub is asked                   → that sub; when one says yes → whoever asked

create table push_outbox (
  id bigint generated always as identity primary key,
  user_ids uuid[] not null,
  title text not null,
  body text not null,
  url text not null,
  tag text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index on push_outbox (id) where sent_at is null;
alter table push_outbox enable row level security;
revoke all on push_outbox from anon, authenticated;

-- Queue a notification (never to whoever did it).
create function queue_push(p_users uuid[], p_title text, p_body text, p_url text, p_tag text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  who uuid[];
begin
  select coalesce(array_agg(distinct u), '{}') into who from unnest(p_users) u
  where u is not null and u is distinct from auth.uid();
  if cardinality(who) = 0 then return; end if;
  insert into push_outbox (user_ids, title, body, url, tag) values (who, left(p_title, 120), left(p_body, 300), p_url, p_tag);
end $$;

-- The server function takes what's waiting (each message once, even if called twice at the same time).
create function take_push_outbox() returns setof push_outbox
language sql security definer set search_path = public as $$
  update push_outbox set sent_at = now()
  where id in (select id from push_outbox where sent_at is null order by id limit 200 for update skip locked)
  returning *
$$;

-- New messages wake the push function (Supabase only: pg_net isn't in local test databases).
create function push_outbox_send() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if to_regnamespace('net') is null then return null; end if;
  perform net.http_post(
    url := 'https://foxthtwxgfnoqxrcbxfc.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select token from cron_secret)),
    body := '{"action": "outbox"}'::jsonb
  );
  return null;
end $$;
create trigger push_outbox_send after insert on push_outbox for each statement execute function push_outbox_send();

-- ── Wording helpers ──────────────────────────────────────────────────────────

-- "T3 at 5:24 PM"
create function tee_label(p_event uuid, p_slot smallint) returns text
language sql stable security definer set search_path = public as $$
  select 'T' || p_slot || coalesce((select ' at ' || to_char(tee_time, 'FMHH12:MI AM') from event_tee_times where event_id = p_event and slot = p_slot), '')
$$;

create function week_url(p_event uuid) returns text
language sql stable security definer set search_path = public as $$
  select '/l/' || l.slug || '/week/' || e.id from events e join leagues l on l.id = e.league_id where e.id = p_event
$$;

create function first_name(p_player uuid) returns text
language sql stable security definer set search_path = public as $$
  select split_part(trim(display_name), ' ', 1) from players where id = p_player
$$;

-- Who did it: their name in this league, or "The commissioner".
create function actor_name(p_league uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select split_part(trim(display_name), ' ', 1) from players where league_id = p_league and user_id = auth.uid() limit 1), 'The commissioner')
$$;

-- ── A captain gives up a tee time (same as migration 26, plus telling people) ──

create or replace function lineup_vacate(p_event uuid, p_player uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s smallint;
  lg uuid;
  wk int;
  label text;
  group_users uuid[];
  commish uuid[];
begin
  select slot, league_id into s, lg from event_tee_times where event_id = p_event and captain_id = p_player;
  if s is null then return '{}'; end if;
  label := tee_label(p_event, s);
  select week_number into wk from events where id = p_event;
  select coalesce(array_agg(p.user_id), '{}') into group_users
  from event_lineup l join players p on p.id = l.player_id
  where l.event_id = p_event and l.slot = s and l.player_id <> p_player and p.user_id is not null;
  select coalesce(array_agg(user_id), '{}') into commish from league_members
  where league_id = lg and role in ('owner', 'commissioner') and user_id not in (select unnest(group_users));

  insert into event_vacated (event_id, player_id, league_id, original_slot, reason)
  values (p_event, p_player, lg, s, p_reason)
  on conflict (event_id, player_id) do update set original_slot = excluded.original_slot, reason = excluded.reason, created_at = now();
  update event_tee_times set captain_id = null where event_id = p_event and slot = s;
  -- The group breaks up: the others are still playing, just without a group.
  delete from event_lineup where event_id = p_event and slot = s and player_id <> p_player;
  update event_lineup set slot = null where event_id = p_event and player_id = p_player;

  perform queue_push(group_users, 'Week ' || wk || ': your ' || label || ' group is off',
    first_name(p_player) || ' gave up the tee time (' || lower(p_reason) || '), so the group broke up. Tap to join another group.',
    week_url(p_event), 'group-' || p_event);
  perform queue_push(commish, 'Week ' || wk || ': ' || first_name(p_player) || ' gave up ' || 'T' || s,
    p_reason || '. The groups behind moved up a tee time.', week_url(p_event), 'vacated-' || p_event);
  return lineup_compress(p_event);
end $$;
revoke execute on function lineup_vacate(uuid, uuid, text) from anon, authenticated, public;

-- ── Groups moving, golfers placed, partners teaming up ───────────────────────

create function lineup_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  u uuid;
  wk int;
  captain boolean;
begin
  select user_id into u from players where id = new.player_id;
  if u is null or u = auth.uid() then return null; end if;
  select week_number into wk from events where id = new.event_id;

  if tg_op = 'UPDATE' then
    -- Their group moved to another tee time (a captain dropped out or was put back in).
    if old.slot is not null and new.slot is not null and old.slot <> new.slot then
      perform queue_push(array[u], 'Week ' || wk || ': your group is now ' || tee_label(new.event_id, new.slot),
        'The tee times moved after a captain change.', week_url(new.event_id), 'slot-' || new.event_id);
    end if;
  elsif new.slot is not null then
    -- Someone else put them in a group (or made them captain).
    captain := exists (select 1 from event_tee_times where event_id = new.event_id and slot = new.slot and captain_id = new.player_id);
    perform queue_push(array[u],
      case when captain then 'Week ' || wk || ': you''re captain of ' || tee_label(new.event_id, new.slot)
           else 'Week ' || wk || ': you''re in ' || tee_label(new.event_id, new.slot) end,
      case when captain then 'Fill your group, or tap "Not playing" if you can''t make it.'
           else actor_name(new.league_id) || ' put you in the group.' end,
      week_url(new.event_id), 'slot-' || new.event_id);
  elsif new.looking = 'match' and new.partner_id is not null then
    -- Someone teamed up with them to look for a match.
    perform queue_push(array[u], 'Week ' || wk || ': ' || first_name(new.partner_id) || ' teamed up with you',
      'You two need a match. Tap to find a group with room.', week_url(new.event_id), 'team-' || new.event_id);
  end if;
  return null;
end $$;
create trigger event_lineup_notify after insert or update of slot on event_lineup
  for each row execute function lineup_notify();

-- ── Sub finder ───────────────────────────────────────────────────────────────

create function sub_offer_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  req sub_requests;
  u uuid;
  wk int;
  lname text;
begin
  select * into req from sub_requests where id = new.request_id;
  select week_number into wk from events where id = req.event_id;
  if tg_op = 'INSERT' then
    select user_id into u from players where id = new.player_id;
    select name into lname from leagues where id = req.league_id;
    perform queue_push(array[u], 'Sub needed: ' || lname || ', week ' || wk,
      'Can you fill in' || coalesce(' at ' || tee_label(req.event_id, req.tee_slot), '') || '? First to say yes gets the spot.',
      week_url(req.event_id), 'sub-' || req.id);
  elsif new.status = 'accepted' and old.status is distinct from 'accepted' then
    perform queue_push(array[req.created_by], 'Week ' || wk || ': ' || first_name(new.player_id) || ' is subbing',
      first_name(new.player_id) || ' took the spot' || coalesce(' at ' || tee_label(req.event_id, req.tee_slot), '') || '.',
      week_url(req.event_id), 'sub-' || req.id);
  end if;
  return null;
end $$;
create trigger sub_offers_notify after insert or update of status on sub_offers
  for each row execute function sub_offer_notify();

revoke execute on function queue_push(uuid[], text, text, text, text), take_push_outbox(), push_outbox_send(),
  tee_label(uuid, smallint), week_url(uuid), first_name(uuid), actor_name(uuid), lineup_notify(), sub_offer_notify()
  from anon, authenticated, public;
grant execute on function take_push_outbox() to service_role;
