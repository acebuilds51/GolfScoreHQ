-- Captains work the way the old OCBC app did.
--
-- A captain's tee time is theirs for the week. If they're not playing, join
-- another group, or the commissioner takes them out, they give it up: their
-- group breaks up (those golfers are still playing, just without a group),
-- every group behind moves up a tee time so the times stay back to back, and
-- the sheet shows who gave up which tee time and why. A captain can't just
-- leave their group. The commissioner can put a captain back in at any tee
-- time, which moves the groups from there on down one.

create table event_vacated (
  event_id uuid not null,
  player_id uuid not null,
  league_id uuid not null,
  -- The tee time they gave up (before the groups moved up).
  original_slot smallint not null,
  reason text not null check (length(reason) <= 80),
  created_at timestamptz not null default now(),
  primary key (event_id, player_id),
  foreign key (league_id, event_id) references events (league_id, id) on delete cascade,
  foreign key (league_id, player_id) references players (league_id, id) on delete cascade
);
alter table event_vacated enable row level security;
create policy "members read vacated captains" on event_vacated for select using (event_visible(event_id));
revoke insert, update, delete on event_vacated from anon, authenticated;

-- Close the gaps: groups with a captain first, then groups without one that
-- have golfers, then empty tee times, each in their current order. Returns
-- where each tee time went ({"old slot": new slot}).
create function lineup_compress(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  moves jsonb;
begin
  -- Tee times are numbered 1, 2, 3…; the nth in the new order gets the nth tee time.
  select coalesce(jsonb_object_agg(o.slot::text, n.slot), '{}') into moves
  from (select t.slot, row_number() over (order by
               (t.captain_id is null),
               not exists (select 1 from event_lineup l where l.event_id = p_event and l.slot = t.slot),
               t.slot) as rn
        from event_tee_times t where t.event_id = p_event) o
  join (select t.slot, row_number() over (order by t.slot) as rn from event_tee_times t where t.event_id = p_event) n on n.rn = o.rn;

  -- Each tee time keeps its clock time; the groups (captain and golfers) move.
  update event_tee_times t set captain_id = src.captain_id
  from event_tee_times src
  where t.event_id = p_event and src.event_id = p_event
    and (moves ->> src.slot::text)::smallint = t.slot and src.slot <> t.slot;
  update event_lineup set slot = (moves ->> slot::text)::smallint
  where event_id = p_event and slot is not null and (moves ->> slot::text)::smallint <> slot;
  return moves;
end $$;

-- A captain gives up their tee time (no-op for anyone who isn't a captain).
create function lineup_vacate(p_event uuid, p_player uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s smallint;
  lg uuid;
begin
  select slot, league_id into s, lg from event_tee_times where event_id = p_event and captain_id = p_player;
  if s is null then return '{}'; end if;
  insert into event_vacated (event_id, player_id, league_id, original_slot, reason)
  values (p_event, p_player, lg, s, p_reason)
  on conflict (event_id, player_id) do update set original_slot = excluded.original_slot, reason = excluded.reason, created_at = now();
  update event_tee_times set captain_id = null where event_id = p_event and slot = s;
  -- The group breaks up: the others are still playing, just without a group.
  delete from event_lineup where event_id = p_event and slot = s and player_id <> p_player;
  update event_lineup set slot = null where event_id = p_event and player_id = p_player;
  return lineup_compress(p_event);
end $$;

-- Out of any group (a captain gives up their tee time first).
create or replace function lineup_clear(p_event uuid, p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform lineup_vacate(p_event, p_player, 'Out this week');
  -- Whoever they'd paired up with is looking for a partner again.
  update event_lineup set looking = 'partner', partner_id = null where event_id = p_event and partner_id = p_player;
  delete from event_lineup where event_id = p_event and player_id = p_player;
end $$;

create or replace function lineup_join(p_event uuid, p_player uuid, p_slot smallint) returns void
language plpgsql security definer set search_path = public as $$
declare
  ev events;
  n int;
  own smallint;
  moves jsonb;
begin
  ev := lineup_guard(p_event);
  if not exists (select 1 from players where id = p_player and league_id = ev.league_id and active) then raise exception 'Golfer not found.'; end if;
  if not lineup_can_place(ev, p_player, p_slot) then raise exception 'You can add yourself, or golfers to your own group.'; end if;
  if not exists (select 1 from event_tee_times where event_id = p_event and slot = p_slot) then raise exception 'No such tee time.'; end if;
  select count(*) into n from event_lineup where event_id = p_event and slot = p_slot and player_id <> p_player;
  if n >= 5 or (n >= 4 and not is_commissioner(ev.league_id)) then raise exception 'That group is full.'; end if;

  -- A captain joining another group gives up their own tee time; the group
  -- they're joining may move up a tee time when the gap closes.
  select slot into own from event_tee_times where event_id = p_event and captain_id = p_player;
  if own is not null and own <> p_slot then
    moves := lineup_vacate(p_event, p_player, 'Playing in another group');
    p_slot := coalesce((moves ->> p_slot::text)::smallint, p_slot);
    update event_vacated set reason = 'Playing in T' || p_slot where event_id = p_event and player_id = p_player;
  end if;

  if not exists (select 1 from event_lineup where event_id = p_event and player_id = p_player and slot = p_slot) then
    perform lineup_clear(p_event, p_player);
    insert into event_lineup (event_id, player_id, league_id, slot, updated_by) values (p_event, p_player, ev.league_id, p_slot, auth.uid());
  end if;
  perform lineup_rsvp(ev, p_player, 'in');
end $$;

create or replace function lineup_leave(p_event uuid, p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  ev events;
  s smallint;
begin
  ev := lineup_guard(p_event);
  select slot into s from event_lineup where event_id = p_event and player_id = p_player;
  if exists (select 1 from event_tee_times where event_id = p_event and captain_id = p_player) then
    if not is_commissioner(ev.league_id) then
      raise exception 'Captains can''t leave their group. Tap "Not playing", or ask the commissioner.';
    end if;
    perform lineup_vacate(p_event, p_player, 'Taken out by the commissioner');
  elsif not lineup_can_place(ev, p_player, s) then
    raise exception 'You can only take yourself out, or golfers from your own group.';
  end if;
  perform lineup_clear(p_event, p_player);
end $$;

create or replace function lineup_status(p_event uuid, p_player uuid, p_status text, p_partner uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  ev events;
  why text;
begin
  ev := lineup_guard(p_event);
  if not acts_for_player(p_player) then raise exception 'You can only change your own status.'; end if;
  if p_status not in ('partner', 'match', 'out', 'none') then raise exception 'Unknown status.'; end if;
  if p_status = 'match' and (p_partner is null or p_partner = p_player
      or not exists (select 1 from players where id = p_partner and league_id = ev.league_id and active)) then
    raise exception 'Pick your partner.';
  end if;

  why := case p_status when 'partner' then 'Looking for a partner' when 'match' then 'Looking for a match' else 'Out this week' end;
  perform lineup_vacate(p_event, p_player, why);
  perform lineup_clear(p_event, p_player);
  if p_status = 'out' then
    perform lineup_rsvp(ev, p_player, 'out');
  elsif p_status = 'partner' then
    insert into event_lineup (event_id, player_id, league_id, looking, updated_by) values (p_event, p_player, ev.league_id, 'partner', auth.uid());
    perform lineup_rsvp(ev, p_player, 'in');
  elsif p_status = 'match' then
    perform lineup_vacate(p_event, p_partner, 'Looking for a match');
    perform lineup_clear(p_event, p_partner);
    insert into event_lineup (event_id, player_id, league_id, looking, partner_id, updated_by) values
      (p_event, p_player, ev.league_id, 'match', p_partner, auth.uid()),
      (p_event, p_partner, ev.league_id, 'match', p_player, auth.uid());
    perform lineup_rsvp(ev, p_player, 'in');
    perform lineup_rsvp(ev, p_partner, 'in');
  end if;
end $$;

-- Commissioner: put a captain in at a tee time. The groups from there on move
-- down one (into the first empty tee time after it).
create function lineup_restore_captain(p_event uuid, p_player uuid, p_slot smallint) returns void
language plpgsql security definer set search_path = public as $$
declare
  ev events;
  gap smallint;
begin
  ev := lineup_guard(p_event);
  if not is_commissioner(ev.league_id) then raise exception 'commissioners only'; end if;
  if not exists (select 1 from players where id = p_player and league_id = ev.league_id and active) then raise exception 'Golfer not found.'; end if;
  if not exists (select 1 from event_tee_times where event_id = p_event and slot = p_slot) then raise exception 'No such tee time.'; end if;
  if exists (select 1 from event_tee_times where event_id = p_event and captain_id = p_player) then
    raise exception 'They already captain a tee time this week.';
  end if;

  perform lineup_clear(p_event, p_player);
  select min(t.slot) into gap from event_tee_times t
  where t.event_id = p_event and t.slot >= p_slot and t.captain_id is null
    and not exists (select 1 from event_lineup l where l.event_id = p_event and l.slot = t.slot);
  if gap is null then
    raise exception 'Every tee time from T% on has golfers in it. Add a tee time for this week first.', p_slot;
  end if;

  -- Move the groups from p_slot up to the gap down one tee time.
  update event_lineup set slot = slot + 1 where event_id = p_event and slot >= p_slot and slot < gap;
  update event_tee_times t set captain_id = src.captain_id
  from event_tee_times src
  where t.event_id = p_event and src.event_id = p_event and src.slot = t.slot - 1 and t.slot > p_slot and t.slot <= gap;
  update event_tee_times set captain_id = p_player where event_id = p_event and slot = p_slot;
  insert into event_lineup (event_id, player_id, league_id, slot, updated_by) values (p_event, p_player, ev.league_id, p_slot, auth.uid());
  perform lineup_rsvp(ev, p_player, 'in');
  delete from event_vacated where event_id = p_event and player_id = p_player;
end $$;

grant execute on function lineup_restore_captain(uuid, uuid, smallint) to authenticated;
revoke execute on function lineup_restore_captain(uuid, uuid, smallint) from anon, public;
revoke execute on function lineup_compress(uuid), lineup_vacate(uuid, uuid, text), lineup_clear(uuid, uuid) from anon, authenticated, public;

-- Everyone's tee sheet updates live when a captain gives up a tee time.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables)
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_vacated') then
    alter publication supabase_realtime add table public.event_vacated;
  end if;
end $$;

-- Merging duplicate golfers also moves their vacated tee times.
create or replace function merge_players_lineup(p_keep uuid, p_drop uuid) returns void
language sql security definer set search_path = public as $$
  delete from event_lineup x where x.player_id = p_drop and exists (select 1 from event_lineup y where y.player_id = p_keep and y.event_id = x.event_id);
  update event_lineup set player_id = p_keep where player_id = p_drop;
  update event_lineup set partner_id = p_keep where partner_id = p_drop;
  update event_tee_times set captain_id = p_keep where captain_id = p_drop;
  delete from event_vacated x where x.player_id = p_drop and exists (select 1 from event_vacated y where y.player_id = p_keep and y.event_id = x.event_id);
  update event_vacated set player_id = p_keep where player_id = p_drop;
$$;
revoke execute on function merge_players_lineup(uuid, uuid) from anon, authenticated, public;
