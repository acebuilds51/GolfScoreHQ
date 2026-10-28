-- Tee sheet (Pro, "lineup"): the week's tee times before anyone plays.
--
-- The commissioner sets the tee times and a captain for each. Golfers join a
-- group (up to 4; captains can fill their own group; commissioners can place
-- anyone), or say they need a partner, that they and a partner need a match,
-- or that they're not playing. Everyone sees it all, and the app texts the
-- right people from there. On league night a group's tee time fills in from
-- here. Changes go through the functions below, which enforce the rules.

create table event_tee_times (
  event_id uuid not null,
  league_id uuid not null,
  slot smallint not null check (slot between 1 and 30),
  tee_time time,
  captain_id uuid references players (id) on delete set null,
  primary key (event_id, slot),
  foreign key (league_id, event_id) references events (league_id, id) on delete cascade
);

create table event_lineup (
  event_id uuid not null,
  player_id uuid not null,
  league_id uuid not null,
  -- In this tee time's group.
  slot smallint,
  -- Not in a group yet: needs a partner, or needs a match with partner_id.
  looking text check (looking in ('partner', 'match')),
  partner_id uuid references players (id) on delete set null,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  primary key (event_id, player_id),
  foreign key (league_id, event_id) references events (league_id, id) on delete cascade,
  foreign key (league_id, player_id) references players (league_id, id) on delete cascade,
  check (slot is null or looking is null),
  check (looking = 'match' or partner_id is null)
);

alter table event_tee_times enable row level security;
alter table event_lineup enable row level security;
create policy "members read tee times" on event_tee_times for select using (event_visible(event_id));
create policy "members read lineup" on event_lineup for select using (event_visible(event_id));
revoke insert, update, delete on event_tee_times, event_lineup from anon, authenticated;

-- Group size: 4 golfers; a commissioner can add a fifth (skins only) on the night.
create function lineup_guard(p_event uuid) returns events
language plpgsql stable security definer set search_path = public as $$
declare
  ev events;
begin
  select * into ev from events where id = p_event;
  if ev.id is null then raise exception 'no such week'; end if;
  if not is_league_member(ev.league_id) then raise exception 'members only'; end if;
  if not league_has_feature(ev.league_id, 'lineup') then
    raise exception 'plan_feature: The tee sheet needs GolfScoreHQ Pro' using errcode = 'P0001';
  end if;
  if ev.status in ('settled', 'rainout') then raise exception 'This week is over.'; end if;
  return ev;
end $$;

-- Golfer, captain of the slot, or commissioner.
create function lineup_can_place(ev events, p_player uuid, p_slot smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select acts_for_player(p_player)
      or (p_slot is not null and exists (
            select 1 from event_tee_times t join players c on c.id = t.captain_id
            where t.event_id = ev.id and t.slot = p_slot and c.user_id = auth.uid()))
$$;

-- Out of any group and any captaincy (their tee time stays, open for someone else).
create function lineup_clear(p_event uuid, p_player uuid) returns void
language sql security definer set search_path = public as $$
  update event_tee_times set captain_id = null where event_id = p_event and captain_id = p_player;
  -- Whoever they'd paired up with is looking for a partner again.
  update event_lineup set looking = 'partner', partner_id = null where event_id = p_event and partner_id = p_player;
  delete from event_lineup where event_id = p_event and player_id = p_player;
$$;

create function lineup_rsvp(ev events, p_player uuid, p_status text) returns void
language sql security definer set search_path = public as $$
  insert into event_rsvps (event_id, player_id, league_id, status, responded_by)
  values (ev.id, p_player, ev.league_id, p_status, auth.uid())
  on conflict (event_id, player_id) do update set status = excluded.status, responded_by = excluded.responded_by, responded_at = now();
$$;

-- Commissioner: the week's tee times. p_times = [{ "slot", "time" ("17:10" or null), "captainId" (or null) }].
create function set_tee_times(p_event uuid, p_times jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  ev events;
  t record;
begin
  ev := lineup_guard(p_event);
  if not is_commissioner(ev.league_id) then raise exception 'commissioners only'; end if;
  if jsonb_typeof(p_times) <> 'array' or jsonb_array_length(p_times) > 30 then raise exception 'Up to 30 tee times.'; end if;

  delete from event_tee_times where event_id = p_event;
  -- Groups at tee times that no longer exist go back to unplaced.
  update event_lineup set slot = null where event_id = p_event
    and slot not in (select (x ->> 'slot')::smallint from jsonb_array_elements(p_times) x);
  for t in select (x ->> 'slot')::smallint as slot, nullif(x ->> 'time', '')::time as tee_time, nullif(x ->> 'captainId', '')::uuid as captain
           from jsonb_array_elements(p_times) x loop
    if t.captain is not null and not exists (select 1 from players where id = t.captain and league_id = ev.league_id) then
      raise exception 'That captain isn''t in this league.';
    end if;
    insert into event_tee_times (event_id, league_id, slot, tee_time, captain_id) values (p_event, ev.league_id, t.slot, t.tee_time, t.captain);
    if t.captain is not null then
      -- A captain plays in their own group.
      delete from event_lineup where event_id = p_event and player_id = t.captain;
      insert into event_lineup (event_id, player_id, league_id, slot, updated_by) values (p_event, t.captain, ev.league_id, t.slot, auth.uid());
      perform lineup_rsvp(ev, t.captain, 'in');
    end if;
  end loop;
end $$;

-- Put a golfer in a tee time's group (leaving any other group or captaincy).
create function lineup_join(p_event uuid, p_player uuid, p_slot smallint) returns void
language plpgsql security definer set search_path = public as $$
declare
  ev events;
  n int;
  cap uuid;
begin
  ev := lineup_guard(p_event);
  if not exists (select 1 from players where id = p_player and league_id = ev.league_id and active) then raise exception 'Golfer not found.'; end if;
  if not lineup_can_place(ev, p_player, p_slot) then raise exception 'You can add yourself, or golfers to a group you captain.'; end if;
  select captain_id into cap from event_tee_times where event_id = p_event and slot = p_slot;
  if not found then raise exception 'No such tee time.'; end if;
  select count(*) into n from event_lineup where event_id = p_event and slot = p_slot and player_id <> p_player;
  if n >= 5 or (n >= 4 and not is_commissioner(ev.league_id)) then raise exception 'That group is full.'; end if;

  if not exists (select 1 from event_lineup where event_id = p_event and player_id = p_player and slot = p_slot) then
    perform lineup_clear(p_event, p_player);
    insert into event_lineup (event_id, player_id, league_id, slot, updated_by) values (p_event, p_player, ev.league_id, p_slot, auth.uid());
  end if;
  -- First one into a captainless tee time runs it.
  if cap is null then update event_tee_times set captain_id = p_player where event_id = p_event and slot = p_slot; end if;
  perform lineup_rsvp(ev, p_player, 'in');
end $$;

-- Take a golfer out of their group (they still plan to play).
create function lineup_leave(p_event uuid, p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  ev events;
  s smallint;
begin
  ev := lineup_guard(p_event);
  select slot into s from event_lineup where event_id = p_event and player_id = p_player;
  if not lineup_can_place(ev, p_player, s) then raise exception 'You can only take yourself out, or golfers from a group you captain.'; end if;
  perform lineup_clear(p_event, p_player);
end $$;

-- A golfer's status: 'partner' (needs a partner), 'match' (with p_partner, needs a match),
-- 'out' (not playing) or 'none' (clear it).
create function lineup_status(p_event uuid, p_player uuid, p_status text, p_partner uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  ev events;
begin
  ev := lineup_guard(p_event);
  if not acts_for_player(p_player) then raise exception 'You can only change your own status.'; end if;
  if p_status not in ('partner', 'match', 'out', 'none') then raise exception 'Unknown status.'; end if;
  if p_status = 'match' and (p_partner is null or p_partner = p_player
      or not exists (select 1 from players where id = p_partner and league_id = ev.league_id and active)) then
    raise exception 'Pick your partner.';
  end if;

  perform lineup_clear(p_event, p_player);
  if p_status = 'out' then
    perform lineup_rsvp(ev, p_player, 'out');
  elsif p_status = 'partner' then
    insert into event_lineup (event_id, player_id, league_id, looking, updated_by) values (p_event, p_player, ev.league_id, 'partner', auth.uid());
    perform lineup_rsvp(ev, p_player, 'in');
  elsif p_status = 'match' then
    perform lineup_clear(p_event, p_partner);
    insert into event_lineup (event_id, player_id, league_id, looking, partner_id, updated_by) values
      (p_event, p_player, ev.league_id, 'match', p_partner, auth.uid()),
      (p_event, p_partner, ev.league_id, 'match', p_player, auth.uid());
    perform lineup_rsvp(ev, p_player, 'in');
    perform lineup_rsvp(ev, p_partner, 'in');
  end if;
end $$;

grant execute on function set_tee_times(uuid, jsonb), lineup_join(uuid, uuid, smallint), lineup_leave(uuid, uuid), lineup_status(uuid, uuid, text, uuid) to authenticated;
revoke execute on function set_tee_times(uuid, jsonb), lineup_join(uuid, uuid, smallint), lineup_leave(uuid, uuid), lineup_status(uuid, uuid, text, uuid) from anon, public;
revoke execute on function lineup_guard(uuid), lineup_can_place(events, uuid, smallint), lineup_clear(uuid, uuid), lineup_rsvp(events, uuid, text) from anon, authenticated, public;

-- Everyone's tee sheet updates live when someone joins or changes their status.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables) then
    return;
  end if;
  foreach t in array array['event_tee_times', 'event_lineup', 'event_rsvps'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Merging duplicate golfers also moves their tee sheet entries.
create or replace function merge_players_lineup(p_keep uuid, p_drop uuid) returns void
language sql security definer set search_path = public as $$
  delete from event_lineup x where x.player_id = p_drop and exists (select 1 from event_lineup y where y.player_id = p_keep and y.event_id = x.event_id);
  update event_lineup set player_id = p_keep where player_id = p_drop;
  update event_lineup set partner_id = p_keep where partner_id = p_drop;
  update event_tee_times set captain_id = p_keep where captain_id = p_drop;
$$;
revoke execute on function merge_players_lineup(uuid, uuid) from anon, authenticated, public;

-- Same as migration 19, plus the tee sheet.
create or replace function merge_players(p_keep uuid, p_drop uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  k players;
  d players;
  clash text;
begin
  if p_keep = p_drop then raise exception 'Pick two different golfers.'; end if;
  select * into k from players where id = p_keep for update;
  select * into d from players where id = p_drop for update;
  if k.id is null or d.id is null then raise exception 'Golfer not found.'; end if;
  if k.league_id <> d.league_id then raise exception 'Both golfers must be in the same league.'; end if;
  if not is_commissioner(k.league_id) then raise exception 'commissioners only'; end if;
  if k.user_id is not null and d.user_id is not null and k.user_id <> d.user_id then
    raise exception 'Both golfers have their own app accounts, so they are different people.';
  end if;

  select 'week ' || e.week_number || ', tee time ' || r.tee_slot into clash
  from round_players a
  join round_players b on b.round_id = a.round_id
  join rounds r on r.id = a.round_id
  join events e on e.id = r.event_id
  where a.player_id = p_keep and b.player_id = p_drop
  limit 1;
  if clash is not null then
    raise exception 'They played in the same group (%), so they are different golfers.', clash;
  end if;

  insert into round_players (round_id, player_id, league_id, side, position, course_handicap)
  select round_id, p_keep, league_id, side, position, course_handicap from round_players where player_id = p_drop;
  update hole_scores set player_id = p_keep where player_id = p_drop;
  delete from round_players where player_id = p_drop;

  update ctp_reports set player_id = p_keep where player_id = p_drop;
  update ctp_reports set beat_player_id = p_keep where beat_player_id = p_drop;
  update ctp_reports set beat_player_id = null where beat_player_id = player_id;
  update ctp_decisions set player_id = p_keep where player_id = p_drop;
  update ledger_entries set player_id = p_keep where player_id = p_drop;
  update payments set player_id = p_keep where player_id = p_drop;
  update invites set player_id = p_keep where player_id = p_drop;

  delete from event_rsvps x where x.player_id = p_drop and exists (select 1 from event_rsvps y where y.player_id = p_keep and y.event_id = x.event_id);
  update event_rsvps set player_id = p_keep where player_id = p_drop;
  delete from sub_offers x where x.player_id = p_drop and exists (select 1 from sub_offers y where y.player_id = p_keep and y.request_id = x.request_id);
  update sub_offers set player_id = p_keep where player_id = p_drop;
  perform merge_players_lineup(p_keep, p_drop);

  if exists (select 1 from player_contacts where player_id = p_keep) then
    update player_contacts c set
      email = coalesce(c.email, (select email from player_contacts where player_id = p_drop)),
      phone = coalesce(c.phone, (select phone from player_contacts where player_id = p_drop))
    where c.player_id = p_keep;
    delete from player_contacts where player_id = p_drop;
  else
    update player_contacts set player_id = p_keep where player_id = p_drop;
  end if;
  if exists (select 1 from notification_prefs where player_id = p_keep) then
    delete from notification_prefs where player_id = p_drop;
  else
    update notification_prefs set player_id = p_keep where player_id = p_drop;
  end if;

  delete from players where id = p_drop;
  update players set
    display_name = regexp_replace(trim(k.display_name), '\s+', ' ', 'g'),
    user_id = coalesce(k.user_id, d.user_id),
    handicap_index = coalesce(k.handicap_index, d.handicap_index),
    handicap_index_updated_at = case when k.handicap_index is null then d.handicap_index_updated_at else k.handicap_index_updated_at end,
    ghin_number = coalesce(k.ghin_number, d.ghin_number),
    active = k.active or d.active
  where id = p_keep;
end $$;
