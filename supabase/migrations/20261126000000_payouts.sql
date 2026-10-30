-- Paying out (Pro, with "payments"). The app never moves money: it fills in
-- Venmo / PayPal for the commissioner and keeps track of who's been paid.
--
-- How a league handles its money (OCBC's way is the default):
--   match money: 'golfers'     match and press money is settled between the golfers;
--                               the app only shows what each won or lost.
--                'commissioner' it goes through the commissioner with the side games.
--   Skins, closest to the pin and prize money are always paid by the commissioner.
--   Season dues: what each golfer pays the commissioner up front (OCBC: the
--   season's skins and CTP money), with a checklist of who's paid.
--
--   player_pay_handles  each golfer's own Venmo / PayPal / Zelle (the golfer or a commissioner sets it)
--   dues_payments       who has paid the season's dues
--   payouts_paid        which week's winnings the commissioner has paid (or collected), and how much

alter table leagues add column match_money text not null default 'golfers' check (match_money in ('golfers', 'commissioner'));
grant update (match_money) on leagues to authenticated;

alter table seasons add column dues_cents int check (dues_cents is null or dues_cents between 0 and 1000000);

create table player_pay_handles (
  player_id uuid primary key,
  league_id uuid not null,
  venmo text check (venmo is null or venmo ~ '^@?[A-Za-z0-9_-]{1,30}$'),
  paypal_me text check (paypal_me is null or paypal_me ~ '^[A-Za-z0-9_.-]{1,40}$'),
  zelle text check (zelle is null or length(zelle) <= 80),
  updated_at timestamptz not null default now(),
  foreign key (league_id, player_id) references players (league_id, id) on delete cascade
);
alter table player_pay_handles enable row level security;
-- The golfer and the commissioners: only they need it, to pay that golfer.
create policy "golfer or commissioner reads pay handles" on player_pay_handles for select using (acts_for_player(player_id));
create policy "golfer or commissioner adds pay handles" on player_pay_handles for insert with check (acts_for_player(player_id));
create policy "golfer or commissioner edits pay handles" on player_pay_handles for update using (acts_for_player(player_id)) with check (acts_for_player(player_id));
create policy "golfer or commissioner removes pay handles" on player_pay_handles for delete using (acts_for_player(player_id));

create table dues_payments (
  season_id uuid not null,
  player_id uuid not null,
  league_id uuid not null,
  amount_cents int not null,
  paid_at timestamptz not null default now(),
  marked_by uuid references auth.users (id),
  primary key (season_id, player_id),
  foreign key (league_id, season_id) references seasons (league_id, id) on delete cascade,
  foreign key (league_id, player_id) references players (league_id, id) on delete cascade
);
alter table dues_payments enable row level security;
create policy "golfer or commissioner sees dues paid" on dues_payments for select using (acts_for_player(player_id));
revoke insert, update, delete on dues_payments from anon, authenticated;

create table payouts_paid (
  event_id uuid not null,
  player_id uuid not null,
  league_id uuid not null,
  -- What was paid (or, if negative, collected); if the week is resettled and
  -- the amount changes, the app shows the difference.
  amount_cents int not null,
  paid_at timestamptz not null default now(),
  marked_by uuid references auth.users (id),
  primary key (event_id, player_id),
  foreign key (league_id, event_id) references events (league_id, id) on delete cascade,
  foreign key (league_id, player_id) references players (league_id, id) on delete cascade
);
alter table payouts_paid enable row level security;
create policy "golfer or commissioner sees payouts" on payouts_paid for select using (acts_for_player(player_id));
revoke insert, update, delete on payouts_paid from anon, authenticated;

-- Commissioner: the season's dues per golfer (null: none).
create function set_season_dues(p_season uuid, p_cents int) returns void
language plpgsql security definer set search_path = public as $$
declare lg uuid;
begin
  select league_id into lg from seasons where id = p_season;
  if lg is null or not is_commissioner(lg) then raise exception 'commissioners only'; end if;
  if not league_has_feature(lg, 'payments') then raise exception 'plan_feature: Tracking dues and payouts needs GolfScoreHQ Pro' using errcode = 'P0001'; end if;
  if p_cents is not null and (p_cents < 0 or p_cents > 1000000) then raise exception 'Enter dues up to $10,000.'; end if;
  update seasons set dues_cents = nullif(p_cents, 0) where id = p_season;
end $$;

-- Commissioner: tick (or untick) a golfer's season dues.
create function mark_dues_paid(p_season uuid, p_player uuid, p_paid boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s seasons;
begin
  select * into s from seasons where id = p_season;
  if s.id is null or not is_commissioner(s.league_id) then raise exception 'commissioners only'; end if;
  if not exists (select 1 from players where id = p_player and league_id = s.league_id) then raise exception 'not in this league'; end if;
  if p_paid then
    insert into dues_payments (season_id, player_id, league_id, amount_cents, marked_by)
    values (p_season, p_player, s.league_id, coalesce(s.dues_cents, 0), auth.uid())
    on conflict (season_id, player_id) do update set amount_cents = excluded.amount_cents, paid_at = now(), marked_by = auth.uid();
  else
    delete from dues_payments where season_id = p_season and player_id = p_player;
  end if;
end $$;

-- Commissioner: tick (or untick) a golfer's winnings for a settled week, recording the amount.
create function mark_payout_paid(p_event uuid, p_player uuid, p_amount_cents int, p_paid boolean) returns void
language plpgsql security definer set search_path = public as $$
declare ev events;
begin
  select * into ev from events where id = p_event;
  if ev.id is null or not is_commissioner(ev.league_id) then raise exception 'commissioners only'; end if;
  if ev.status <> 'settled' then raise exception 'Settle the week first.'; end if;
  if not exists (select 1 from ledger_entries where event_id = p_event and player_id = p_player) then raise exception 'That golfer has nothing from this week.'; end if;
  if p_paid then
    insert into payouts_paid (event_id, player_id, league_id, amount_cents, marked_by)
    values (p_event, p_player, ev.league_id, p_amount_cents, auth.uid())
    on conflict (event_id, player_id) do update set amount_cents = excluded.amount_cents, paid_at = now(), marked_by = auth.uid();
  else
    delete from payouts_paid where event_id = p_event and player_id = p_player;
  end if;
end $$;

grant execute on function set_season_dues(uuid, int), mark_dues_paid(uuid, uuid, boolean), mark_payout_paid(uuid, uuid, int, boolean) to authenticated;
revoke execute on function set_season_dues(uuid, int), mark_dues_paid(uuid, uuid, boolean), mark_payout_paid(uuid, uuid, int, boolean) from anon, public;
