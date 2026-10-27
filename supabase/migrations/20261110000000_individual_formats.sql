-- Stroke play and Stableford.
--
-- Both are individual formats: groups have no sides, and the week pays prize
-- money by finishing place ("payouts" in the season rules, cents for 1st, 2nd…).
-- Stroke play is on every plan (rules_are_basic_format already allows it);
-- Stableford needs Pro ("all_formats"). Prize money counts as a side game.

-- Prize money for a finishing place.
alter table ledger_entries drop constraint ledger_entries_kind_check;
alter table ledger_entries add constraint ledger_entries_kind_check
  check (kind in ('match', 'press', 'skin', 'ctp', 'scramblePot', 'place', 'dues', 'adjustment'));

create or replace function rules_use_side_games(r jsonb) returns boolean
language sql immutable as $$
  select coalesce((r #>> '{skins,enabled}')::boolean, false)
      or coalesce((r #>> '{ctp,enabled}')::boolean, false)
      or coalesce((r #>> '{presses,enabled}')::boolean, false)
      or coalesce((r #>> '{match,stake}')::numeric, 0) > 0
      or coalesce((r ->> 'teamPot')::numeric, 0) > 0
      or (jsonb_typeof(r -> 'payouts') = 'array'
          and exists (select 1 from jsonb_array_elements(r -> 'payouts') p where jsonb_typeof(p) = 'number' and p::text::numeric > 0))
$$;

-- Same as before, with 'place' allowed.
create or replace function settle_event(p_event uuid, p_entries jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  ev events;
  n integer;
begin
  select * into ev from events where id = p_event for update;
  if ev.id is null then raise exception 'no such week'; end if;
  if not is_commissioner(ev.league_id) then raise exception 'commissioners only'; end if;
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
