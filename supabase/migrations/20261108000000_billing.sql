-- Billing with Stripe. Pro is bought per league, Club per club (up to 5 of
-- the buyer's own leagues). Both renew yearly. Stripe hosts checkout, so card
-- details never reach GolfScoreHQ. Only the billing server functions (service
-- role) write these tables; people can read their own billing.

-- The original placeholder table was never used.
drop table subscriptions;

-- One Stripe customer per person who pays.
create table billing_customers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now()
);

create table billing_subscriptions (
  stripe_subscription_id text primary key,
  owner_id uuid not null references auth.users (id),
  league_id uuid references leagues (id) on delete set null,
  club_id uuid references clubs (id) on delete set null,
  plan league_plan not null check (plan in ('pro', 'club')),
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now(),
  check ((plan = 'pro' and league_id is not null and club_id is null) or (plan = 'club' and club_id is not null and league_id is null))
);
create index on billing_subscriptions (league_id);
create index on billing_subscriptions (club_id);

alter table billing_customers enable row level security;
alter table billing_subscriptions enable row level security;
create policy "people read their own customer record" on billing_customers for select using (user_id = auth.uid());
create policy "payers and commissioners read billing" on billing_subscriptions for select
  using (owner_id = auth.uid() or (league_id is not null and is_commissioner(league_id)));
revoke insert, update, delete on billing_customers, billing_subscriptions from anon, authenticated;

-- ── Clubs: owners create them and choose which of their leagues they cover ──

create function create_club(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if length(trim(coalesce(p_name, ''))) not between 2 and 80 then raise exception 'Give the club a name.'; end if;
  insert into clubs (name, owner_id) values (trim(p_name), auth.uid()) returning id into cid;
  return cid;
end $$;

-- Put one of your own leagues under your paid club (or take it out).
create function set_league_club(p_league uuid, p_club uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  lg leagues;
  cl clubs;
begin
  select * into lg from leagues where id = p_league;
  if lg.id is null or lg.owner_id <> auth.uid() then raise exception 'Only the league''s owner can do that.'; end if;
  if p_club is null then
    if lg.club_id is not null then
      update leagues set club_id = null, plan = case when plan = 'club' then 'free' else plan end where id = p_league;
    end if;
    return;
  end if;
  select * into cl from clubs where id = p_club;
  if cl.id is null or cl.owner_id <> auth.uid() then raise exception 'That club isn''t yours.'; end if;
  if cl.plan_expires_at is null or cl.plan_expires_at < now() then raise exception 'Start the Club plan first.'; end if;
  if lg.plan in ('pilot', 'comp') then raise exception 'This league already has GolfScoreHQ free; it doesn''t need the Club.'; end if;
  if exists (select 1 from billing_subscriptions s where s.league_id = p_league and s.status in ('active', 'trialing', 'past_due') and not s.cancel_at_period_end) then
    raise exception 'This league pays for its own Pro plan. Cancel it under Manage billing first, so you aren''t charged twice.';
  end if;
  -- The leagues_club_limit trigger enforces the 5-league cap.
  update leagues set club_id = p_club, plan = 'club', plan_expires_at = null where id = p_league;
end $$;

grant execute on function create_club(text), set_league_club(uuid, uuid) to authenticated;

-- What the league's Settings page shows about its plan.
create function league_billing(p_league uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not is_commissioner(p_league) then null else jsonb_build_object(
    'plan', l.plan,
    'effectivePlan', effective_plan(l.id),
    'expiresAt', case when l.plan = 'club' then c.plan_expires_at else l.plan_expires_at end,
    'clubName', c.name,
    'isOwner', l.owner_id = auth.uid(),
    'subscription', (
      select jsonb_build_object('status', s.status, 'renewsAt', s.current_period_end, 'cancelAtPeriodEnd', s.cancel_at_period_end, 'paidByMe', s.owner_id = auth.uid())
      from billing_subscriptions s
      where (s.league_id = l.id or (l.club_id is not null and s.club_id = l.club_id))
      order by s.updated_at desc limit 1
    )
  ) end
  from leagues l left join clubs c on c.id = l.club_id
  where l.id = p_league
$$;

grant execute on function league_billing(uuid) to authenticated;
