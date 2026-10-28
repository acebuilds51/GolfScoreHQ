-- Season tee times (Pro, "lineup"): set once, every week gets them.
--
-- The commissioner sets the season's tee times during setup. Every upcoming
-- week, including weeks added later, gets them automatically. Captains (for
-- leagues that use them) are still picked week by week. A week's times can be
-- changed on their own ("this week only"); season changes then leave that
-- week alone until the commissioner puts it back on the season's tee times.

create table season_tee_times (
  season_id uuid not null,
  league_id uuid not null,
  slot smallint not null check (slot between 1 and 30),
  tee_time time not null,
  primary key (season_id, slot),
  foreign key (league_id, season_id) references seasons (league_id, id) on delete cascade
);

alter table season_tee_times enable row level security;
create policy "members read season tee times" on season_tee_times for select using (is_league_member(league_id));
revoke insert, update, delete on season_tee_times from anon, authenticated;

-- This week's tee times were changed on their own.
alter table events add column custom_tee_times boolean not null default false;
-- Weeks already posted one at a time keep what they have.
update events set custom_tee_times = true where id in (select event_id from event_tee_times);

-- Bring an upcoming week in line with its season's tee times (the week's
-- captains and groups stay with their tee time).
create function sync_week_tee_times(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  ev events;
begin
  select * into ev from events where id = p_event;
  if ev.id is null or ev.custom_tee_times or ev.status <> 'scheduled'
     or exists (select 1 from rounds where event_id = p_event) then
    return;
  end if;
  -- Tee times the season no longer has: their golfers go back to unplaced.
  update event_lineup set slot = null where event_id = p_event and slot is not null
    and slot not in (select slot from season_tee_times where season_id = ev.season_id);
  delete from event_tee_times where event_id = p_event
    and slot not in (select slot from season_tee_times where season_id = ev.season_id);
  insert into event_tee_times (event_id, league_id, slot, tee_time)
  select p_event, ev.league_id, slot, tee_time from season_tee_times where season_id = ev.season_id
  on conflict (event_id, slot) do update set tee_time = excluded.tee_time;
end $$;

-- Commissioner: the season's tee times. p_times = ["17:10", "17:17", …] (tee time 1, 2, …).
create function set_season_tee_times(p_season uuid, p_times jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  sn seasons;
  e uuid;
begin
  select * into sn from seasons where id = p_season;
  if sn.id is null then raise exception 'no such season'; end if;
  if not is_commissioner(sn.league_id) then raise exception 'commissioners only'; end if;
  if not league_has_feature(sn.league_id, 'lineup') then
    raise exception 'plan_feature: The tee sheet needs GolfScoreHQ Pro' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_times) <> 'array' or jsonb_array_length(p_times) > 30 then raise exception 'Up to 30 tee times.'; end if;
  if exists (select 1 from jsonb_array_elements_text(p_times) x where nullif(x, '') is null) then raise exception 'Every tee time needs a time.'; end if;

  delete from season_tee_times where season_id = p_season;
  insert into season_tee_times (season_id, league_id, slot, tee_time)
  select p_season, sn.league_id, n::smallint, x::time from jsonb_array_elements_text(p_times) with ordinality as t(x, n);

  for e in select id from events where season_id = p_season loop
    perform sync_week_tee_times(e);
  end loop;
end $$;

-- Commissioner: put a week changed on its own back on the season's tee times.
create function use_season_tee_times(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  ev events;
begin
  ev := lineup_guard(p_event);
  if not is_commissioner(ev.league_id) then raise exception 'commissioners only'; end if;
  update events set custom_tee_times = false where id = p_event;
  perform sync_week_tee_times(p_event);
end $$;

-- New weeks start with the season's tee times.
create function events_season_tee_times() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform sync_week_tee_times(new.id);
  return null;
end $$;
create trigger events_season_tee_times after insert on events
  for each row execute function events_season_tee_times();

-- Same as migration 21, and a week whose times differ from the season's is
-- marked as changed on its own (picking captains alone doesn't count).
create or replace function set_tee_times(p_event uuid, p_times jsonb) returns void
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

  update events set custom_tee_times = exists (
    (select slot, tee_time from event_tee_times where event_id = p_event
     except select slot, tee_time from season_tee_times where season_id = ev.season_id)
    union all
    (select slot, tee_time from season_tee_times where season_id = ev.season_id
     except select slot, tee_time from event_tee_times where event_id = p_event)
  ) where id = p_event;
end $$;

-- Most leagues don't have captains: anyone in a group can add golfers to it
-- (and take them out), as can the tee time's captain where the commissioner
-- picked one. Joining an open tee time no longer makes you its captain.
create or replace function lineup_can_place(ev events, p_player uuid, p_slot smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select acts_for_player(p_player)
      or (p_slot is not null and exists (
            select 1 from event_tee_times t join players c on c.id = t.captain_id
            where t.event_id = ev.id and t.slot = p_slot and c.user_id = auth.uid()))
      or (p_slot is not null and exists (
            select 1 from event_lineup l join players m on m.id = l.player_id
            where l.event_id = ev.id and l.slot = p_slot and m.user_id = auth.uid()))
$$;
revoke execute on function lineup_can_place(events, uuid, smallint) from anon, authenticated, public;

create or replace function lineup_join(p_event uuid, p_player uuid, p_slot smallint) returns void
language plpgsql security definer set search_path = public as $$
declare
  ev events;
  n int;
begin
  ev := lineup_guard(p_event);
  if not exists (select 1 from players where id = p_player and league_id = ev.league_id and active) then raise exception 'Golfer not found.'; end if;
  if not lineup_can_place(ev, p_player, p_slot) then raise exception 'You can add yourself, or golfers to your own group.'; end if;
  if not exists (select 1 from event_tee_times where event_id = p_event and slot = p_slot) then raise exception 'No such tee time.'; end if;
  select count(*) into n from event_lineup where event_id = p_event and slot = p_slot and player_id <> p_player;
  if n >= 5 or (n >= 4 and not is_commissioner(ev.league_id)) then raise exception 'That group is full.'; end if;

  if not exists (select 1 from event_lineup where event_id = p_event and player_id = p_player and slot = p_slot) then
    perform lineup_clear(p_event, p_player);
    insert into event_lineup (event_id, player_id, league_id, slot, updated_by) values (p_event, p_player, ev.league_id, p_slot, auth.uid());
  end if;
  perform lineup_rsvp(ev, p_player, 'in');
end $$;

grant execute on function set_season_tee_times(uuid, jsonb), use_season_tee_times(uuid) to authenticated;
revoke execute on function set_season_tee_times(uuid, jsonb), use_season_tee_times(uuid) from anon, public;
revoke execute on function sync_week_tee_times(uuid), events_season_tee_times() from anon, authenticated, public;
