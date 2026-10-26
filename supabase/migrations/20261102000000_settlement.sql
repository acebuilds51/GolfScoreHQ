-- Settling a week.
--
-- The commissioner's app calculates the week with the rules engine and posts
-- the money entries through settle_event(). The function checks the caller is
-- a commissioner of that league, that every entry is for a golfer and group in
-- that week, and that money needs Pro. Users still can't write ledger rows
-- directly.

-- When two groups both claim the same CTP marker, the commissioner decides.
create table ctp_decisions (
  event_id uuid not null,
  league_id uuid not null,
  hole_number smallint not null check (hole_number between 1 and 18),
  player_id uuid not null,
  decided_by uuid not null references auth.users (id),
  decided_at timestamptz not null default now(),
  primary key (event_id, hole_number),
  foreign key (league_id, event_id) references events (league_id, id) on delete cascade,
  foreign key (league_id, player_id) references players (league_id, id)
);

alter table ctp_decisions enable row level security;
create policy "members read ctp decisions" on ctp_decisions for select using (event_visible(event_id));
create policy "commissioners decide ctp" on ctp_decisions for insert
  with check (is_commissioner(league_id) and decided_by = auth.uid());
create policy "commissioners change ctp decisions" on ctp_decisions for update
  using (is_commissioner(league_id)) with check (is_commissioner(league_id) and decided_by = auth.uid());
create policy "commissioners clear ctp decisions" on ctp_decisions for delete using (is_commissioner(league_id));

-- p_entries: [{ "player_id", "round_id" (or null), "kind", "amount_cents", "hole_number" (or null) }]
create function settle_event(p_event uuid, p_entries jsonb) returns integer
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
    where e.kind not in ('match', 'press', 'skin', 'ctp', 'scramblePot')
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

-- Undo a settlement so scores can be fixed; the week is settled again afterwards.
create function reopen_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  ev events;
begin
  select * into ev from events where id = p_event for update;
  if ev.id is null then raise exception 'no such week'; end if;
  if not is_commissioner(ev.league_id) then raise exception 'commissioners only'; end if;
  delete from ledger_entries where event_id = p_event;
  update events set status = 'scheduled', settled_at = null where id = p_event;
end $$;

grant execute on function settle_event(uuid, jsonb), reopen_event(uuid) to authenticated;
revoke execute on function settle_event(uuid, jsonb), reopen_event(uuid) from anon, public;
