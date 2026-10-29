-- "I'd chip in": golfers in a free league tell the commissioner they'd pay
-- their share of Pro for the season. The app works out the share (the Pro
-- price split across the league's golfers); each golfer's offer is kept here,
-- the commissioners get a phone notification, and the running total shows on
-- their upgrade card.

create table upgrade_interest (
  league_id uuid not null references leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  player_id uuid references players (id) on delete set null,
  amount_cents int not null check (amount_cents between 100 and 14900),
  created_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
alter table upgrade_interest enable row level security;
revoke all on upgrade_interest from anon, authenticated;

-- A golfer offers their share. Returns how many golfers have offered.
create function say_would_chip_in(p_league uuid, p_amount_cents int) returns int
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  pl uuid;
  fresh boolean;
  n int;
  total int;
  who text;
  commish uuid[];
  lg leagues;
begin
  if me is null or not is_league_member(p_league) then raise exception 'members only'; end if;
  if effective_plan(p_league) <> 'free' then raise exception 'This league already has Pro.'; end if;
  if p_amount_cents is null or p_amount_cents < 100 or p_amount_cents > 14900 then raise exception 'That amount doesn''t look right.'; end if;
  select id into pl from players where league_id = p_league and user_id = me and active limit 1;
  select not exists (select 1 from upgrade_interest where league_id = p_league and user_id = me) into fresh;
  insert into upgrade_interest (league_id, user_id, player_id, amount_cents) values (p_league, me, pl, p_amount_cents)
  on conflict (league_id, user_id) do update set amount_cents = excluded.amount_cents, player_id = excluded.player_id;
  select count(*), coalesce(sum(amount_cents), 0) into n, total from upgrade_interest where league_id = p_league;

  -- Tell the commissioners the first time each golfer offers.
  if fresh then
    select * into lg from leagues where id = p_league;
    who := coalesce((select split_part(trim(display_name), ' ', 1) from players where id = pl), 'A golfer');
    select coalesce(array_agg(user_id), '{}') into commish from league_members where league_id = p_league and role in ('owner', 'commissioner');
    perform queue_push(commish, who || ' would chip in $' || (p_amount_cents / 100) || ' for Pro',
      n || ' golfer' || case when n = 1 then '' else 's' end || ' so far, $' || (total / 100) || ' of the $149 a year. Tap to see Pro.',
      '/l/' || lg.slug || '/settings', 'pro-interest-' || p_league);
  end if;
  return n;
end $$;

-- Changed their mind.
create function take_back_chip_in(p_league uuid) returns void
language sql security definer set search_path = public as $$
  delete from upgrade_interest where league_id = p_league and user_id = auth.uid()
$$;

-- What the upgrade cards show: how many offered and how much; your own offer;
-- and, for commissioners, who.
create function upgrade_interest_summary(p_league uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_league_member(p_league) then raise exception 'members only'; end if;
  return jsonb_build_object(
    'count', (select count(*) from upgrade_interest where league_id = p_league),
    'total_cents', (select coalesce(sum(amount_cents), 0) from upgrade_interest where league_id = p_league),
    'mine', (select amount_cents from upgrade_interest where league_id = p_league and user_id = auth.uid()),
    'names', case when is_commissioner(p_league) then (
      select coalesce(jsonb_agg(coalesce(p.display_name, u.email) order by i.created_at), '[]')
      from upgrade_interest i left join players p on p.id = i.player_id left join auth.users u on u.id = i.user_id
      where i.league_id = p_league) else '[]'::jsonb end
  );
end $$;

grant execute on function say_would_chip_in(uuid, int), take_back_chip_in(uuid), upgrade_interest_summary(uuid) to authenticated;
revoke execute on function say_would_chip_in(uuid, int), take_back_chip_in(uuid), upgrade_interest_summary(uuid) from anon, public;
