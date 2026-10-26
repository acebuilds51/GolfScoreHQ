-- GolfScoreHQ initial schema.
--
-- Tenancy: every league-owned row carries league_id. Child tables reference
-- their parent with a composite (league_id, id) foreign key, so a row can never
-- point at another league's data. Row-level security limits every query to the
-- leagues the signed-in user belongs to.
--
-- Money is integer cents. Ledger rows are written only by the settlement code
-- (service role); users can read them but never write them directly.

-- ── Plans ────────────────────────────────────────────────────────────────────

create type league_plan as enum ('free', 'pilot', 'league', 'club', 'comp');
create type member_role as enum ('owner', 'commissioner', 'scorer', 'player');

-- Max regular (non-sub) players on a plan; null = unlimited.
create function plan_player_limit(p league_plan) returns int
language sql immutable as $$
  select case p when 'free' then 20 else null end
$$;

-- ── Profiles ─────────────────────────────────────────────────────────────────

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

-- ── Leagues & membership ─────────────────────────────────────────────────────

create table leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  owner_id uuid not null references auth.users (id),
  plan league_plan not null default 'free',
  plan_expires_at timestamptz,
  -- 6-character code golfers can enter to request to join (commissioner approves).
  join_code text unique check (join_code ~ '^[A-Z0-9]{6}$'),
  timezone text not null default 'America/Detroit',
  logo_url text,
  created_at timestamptz not null default now()
);

create table league_members (
  league_id uuid not null references leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role member_role not null default 'player',
  created_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
create index on league_members (user_id);

-- Payment handles the commissioner chooses to show (deep links only; the app never moves money).
create table league_payment_settings (
  league_id uuid primary key references leagues (id) on delete cascade,
  venmo_username text,
  paypal_me text,
  zelle_contact text,
  updated_at timestamptz not null default now()
);

create table subscriptions (
  league_id uuid primary key references leagues (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'none',
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

-- ── Roster ───────────────────────────────────────────────────────────────────

create table players (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 60),
  is_sub boolean not null default false,
  active boolean not null default true,
  -- Set when a golfer claims this roster spot with an account.
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (league_id, id),
  unique (league_id, user_id)
);

-- Contact details live apart from the roster so ordinary members can't read them.
create table player_contacts (
  player_id uuid primary key,
  league_id uuid not null,
  email text,
  phone text,
  foreign key (league_id, player_id) references players (league_id, id) on delete cascade
);

create table invites (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues (id) on delete cascade,
  -- sha256 of the token in the invite link; the raw token is never stored.
  token_hash text not null unique,
  player_id uuid,
  role member_role not null default 'player' check (role <> 'owner'),
  email text,
  created_by uuid not null references auth.users (id),
  expires_at timestamptz not null default now() + interval '30 days',
  accepted_by uuid references auth.users (id),
  accepted_at timestamptz,
  foreign key (league_id, player_id) references players (league_id, id) on delete cascade
);

create table join_requests (
  league_id uuid not null references leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

-- ── Courses ──────────────────────────────────────────────────────────────────

-- league_id null = shared catalog course any league can use.
create table courses (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references leagues (id) on delete cascade,
  name text not null,
  city text,
  state text,
  created_at timestamptz not null default now()
);

-- A playable set of holes: a nine, or a full 18, from one set of tees.
create table layouts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses (id) on delete cascade,
  name text not null,
  tees text,
  -- [{ "number": 1, "par": 4, "strokeIndex": 7 }, ...]
  holes jsonb not null check (jsonb_typeof(holes) = 'array' and jsonb_array_length(holes) in (9, 18)),
  rating numeric(4, 1),
  slope smallint check (slope between 55 and 155)
);

-- ── Seasons, weeks, rounds ───────────────────────────────────────────────────

create table seasons (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues (id) on delete cascade,
  year smallint not null,
  name text not null default '',
  -- Frozen copy of the engine's FormatRules for this season.
  rules jsonb not null,
  start_date date,
  league_day smallint check (league_day between 0 and 6),
  created_at timestamptz not null default now(),
  unique (league_id, id),
  unique (league_id, year, name)
);

create type event_status as enum ('scheduled', 'in_progress', 'settled', 'rainout');

create table events (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null,
  season_id uuid not null,
  week_number smallint not null check (week_number > 0),
  event_date date,
  layout_id uuid references layouts (id),
  -- Per-week rules override (e.g. scramble week); null = season rules.
  rules_override jsonb,
  status event_status not null default 'scheduled',
  settled_at timestamptz,
  unique (league_id, id),
  foreign key (league_id, season_id) references seasons (league_id, id) on delete cascade
);
create index on events (season_id, week_number);

create table rounds (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null,
  event_id uuid not null,
  tee_slot smallint not null check (tee_slot > 0),
  status text not null default 'live' check (status in ('live', 'submitted')),
  current_hole smallint not null default 0,
  submitted_by uuid references auth.users (id),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (league_id, id),
  foreign key (league_id, event_id) references events (league_id, id) on delete cascade
);
create index on rounds (event_id);

create table round_players (
  round_id uuid not null,
  player_id uuid not null,
  league_id uuid not null,
  -- 'A' / 'B' match side; null for skins-only players.
  side text check (side in ('A', 'B')),
  position smallint not null default 0,
  primary key (round_id, player_id),
  foreign key (league_id, round_id) references rounds (league_id, id) on delete cascade,
  foreign key (league_id, player_id) references players (league_id, id)
);

-- One row per player per hole. Upserts keyed on the primary key make offline
-- retries idempotent.
create table hole_scores (
  round_id uuid not null,
  player_id uuid not null,
  league_id uuid not null,
  hole_number smallint not null check (hole_number between 1 and 18),
  strokes smallint not null check (strokes between 1 and 20),
  entered_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  primary key (round_id, player_id, hole_number),
  foreign key (round_id, player_id) references round_players (round_id, player_id) on delete cascade,
  foreign key (league_id, round_id) references rounds (league_id, id) on delete cascade
);

-- Scramble and other one-ball team formats.
create table team_hole_scores (
  round_id uuid not null,
  league_id uuid not null,
  hole_number smallint not null check (hole_number between 1 and 18),
  strokes smallint not null check (strokes between 1 and 20),
  updated_at timestamptz not null default now(),
  primary key (round_id, hole_number),
  foreign key (league_id, round_id) references rounds (league_id, id) on delete cascade
);

create table presses (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null,
  league_id uuid not null,
  start_hole_number smallint not null check (start_hole_number between 1 and 18),
  called_by text not null check (called_by in ('A', 'B')),
  created_at timestamptz not null default now(),
  foreign key (league_id, round_id) references rounds (league_id, id) on delete cascade
);

-- What one group reported for a par 3: a player in the group, or nobody (player_id null).
create table ctp_reports (
  round_id uuid not null,
  league_id uuid not null,
  hole_number smallint not null check (hole_number between 1 and 18),
  player_id uuid,
  primary key (round_id, hole_number),
  foreign key (league_id, round_id) references rounds (league_id, id) on delete cascade,
  foreign key (league_id, player_id) references players (league_id, id)
);

-- ── Money ────────────────────────────────────────────────────────────────────

create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null,
  event_id uuid not null,
  round_id uuid,
  player_id uuid not null,
  kind text not null check (kind in ('match', 'press', 'skin', 'ctp', 'scramblePot', 'dues', 'adjustment')),
  amount_cents integer not null,
  hole_number smallint,
  created_at timestamptz not null default now(),
  foreign key (league_id, event_id) references events (league_id, id) on delete cascade,
  foreign key (league_id, player_id) references players (league_id, id)
);
create index on ledger_entries (league_id, player_id);

-- Money actually handed over (Venmo/PayPal/Zelle/cash), recorded by the commissioner.
create table payments (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null,
  player_id uuid not null,
  -- Positive = player paid the league, negative = league paid the player.
  amount_cents integer not null check (amount_cents <> 0),
  method text not null check (method in ('venmo', 'paypal', 'zelle', 'cash', 'other')),
  note text,
  recorded_by uuid not null references auth.users (id),
  recorded_at timestamptz not null default now(),
  foreign key (league_id, player_id) references players (league_id, id)
);

-- ── Access helpers ───────────────────────────────────────────────────────────
-- security definer so policies can consult league_members without recursing
-- through league_members' own policies.

create function is_league_member(lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from league_members where league_id = lid and user_id = auth.uid())
$$;

create function has_league_role(lid uuid, roles member_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from league_members
    where league_id = lid and user_id = auth.uid() and role = any (roles)
  )
$$;

create function is_commissioner(lid uuid) returns boolean
language sql stable as $$
  select has_league_role(lid, array['owner', 'commissioner']::member_role[])
$$;

-- Scores can be written by any member until the week is settled; after that
-- only commissioners can change them (and must re-settle).
create function can_score_round(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from rounds r join events e on e.id = r.event_id
    where r.id = rid
      and is_league_member(r.league_id)
      and (e.status not in ('settled', 'rainout') or is_commissioner(r.league_id))
  )
$$;

-- ── Plan limits (enforced in the database, not just the UI) ─────────────────

create function enforce_player_limit() returns trigger
language plpgsql as $$
declare
  lim int;
  cnt int;
begin
  if new.is_sub or not new.active then return new; end if;
  select plan_player_limit(plan) into lim from leagues where id = new.league_id;
  if lim is null then return new; end if;
  select count(*) into cnt from players
  where league_id = new.league_id and not is_sub and active and id <> new.id;
  if cnt >= lim then
    raise exception 'plan_limit: this plan allows % regular players', lim using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger players_plan_limit
before insert or update of is_sub, active on players
for each row execute function enforce_player_limit();

create function enforce_free_league_limit() returns trigger
language plpgsql as $$
begin
  if new.plan = 'free' and exists (
    select 1 from leagues where owner_id = new.owner_id and plan = 'free' and id <> new.id
  ) then
    raise exception 'plan_limit: the free plan includes one league' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger leagues_free_limit
before insert on leagues
for each row execute function enforce_free_league_limit();

-- ── RPCs ─────────────────────────────────────────────────────────────────────

-- Create a league and make the caller its owner in one step.
create function create_league(p_name text, p_slug text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  lid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into leagues (name, slug, owner_id) values (p_name, p_slug, auth.uid()) returning id into lid;
  insert into league_members (league_id, user_id, role) values (lid, auth.uid(), 'owner');
  return lid;
end $$;

-- Accept an invite link. Links the caller to the invited roster spot, if any.
create function accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  inv invites;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into inv from invites
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  for update;
  if inv.id is null or inv.accepted_at is not null or inv.expires_at < now() then
    raise exception 'invite is invalid or expired';
  end if;
  insert into league_members (league_id, user_id, role) values (inv.league_id, auth.uid(), inv.role)
  on conflict (league_id, user_id) do nothing;
  if inv.player_id is not null then
    update players set user_id = auth.uid()
    where id = inv.player_id and league_id = inv.league_id and user_id is null;
  end if;
  update invites set accepted_by = auth.uid(), accepted_at = now() where id = inv.id;
  return inv.league_id;
end $$;

-- Ask to join with a league's 6-character code (commissioner approves).
create function request_to_join(p_code text, p_message text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  lid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into lid from leagues where join_code = upper(p_code);
  if lid is null then raise exception 'no league with that code'; end if;
  insert into join_requests (league_id, user_id, message) values (lid, auth.uid(), p_message)
  on conflict (league_id, user_id) do update set status = 'pending', message = excluded.message;
  return lid;
end $$;

-- ── Row-level security ───────────────────────────────────────────────────────

alter table profiles enable row level security;
alter table leagues enable row level security;
alter table league_members enable row level security;
alter table league_payment_settings enable row level security;
alter table subscriptions enable row level security;
alter table players enable row level security;
alter table player_contacts enable row level security;
alter table invites enable row level security;
alter table join_requests enable row level security;
alter table courses enable row level security;
alter table layouts enable row level security;
alter table seasons enable row level security;
alter table events enable row level security;
alter table rounds enable row level security;
alter table round_players enable row level security;
alter table hole_scores enable row level security;
alter table team_hole_scores enable row level security;
alter table presses enable row level security;
alter table ctp_reports enable row level security;
alter table ledger_entries enable row level security;
alter table payments enable row level security;

create policy "own profile" on profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

create policy "members read league" on leagues for select using (is_league_member(id));
create policy "commissioners update league" on leagues for update
  using (is_commissioner(id)) with check (is_commissioner(id));
-- Plan, owner and billing fields change only through the service role (Stripe webhook).
revoke update on leagues from authenticated;
grant update (name, slug, join_code, timezone, logo_url) on leagues to authenticated;

create policy "members read members" on league_members for select using (is_league_member(league_id));
create policy "commissioners manage members" on league_members for all
  using (is_commissioner(league_id) and role <> 'owner')
  with check (is_commissioner(league_id) and role <> 'owner');
create policy "members can leave" on league_members for delete
  using (user_id = auth.uid() and role <> 'owner');

create policy "members read payment handles" on league_payment_settings for select using (is_league_member(league_id));
create policy "commissioners manage payment handles" on league_payment_settings for all
  using (is_commissioner(league_id)) with check (is_commissioner(league_id));

create policy "owner reads subscription" on subscriptions for select
  using (has_league_role(league_id, array['owner']::member_role[]));

create policy "members read roster" on players for select using (is_league_member(league_id));
create policy "commissioners manage roster" on players for all
  using (is_commissioner(league_id)) with check (is_commissioner(league_id));

create policy "commissioners and self read contacts" on player_contacts for select using (
  is_commissioner(league_id)
  or exists (select 1 from players p where p.id = player_id and p.user_id = auth.uid())
);
create policy "commissioners manage contacts" on player_contacts for all
  using (is_commissioner(league_id)) with check (is_commissioner(league_id));
create policy "golfers edit own contact" on player_contacts for update
  using (exists (select 1 from players p where p.id = player_id and p.user_id = auth.uid()))
  with check (exists (select 1 from players p where p.id = player_id and p.user_id = auth.uid()));

create policy "commissioners manage invites" on invites for all
  using (is_commissioner(league_id)) with check (is_commissioner(league_id));

create policy "requester reads own request" on join_requests for select
  using (user_id = auth.uid() or is_commissioner(league_id));
create policy "commissioners decide requests" on join_requests for update
  using (is_commissioner(league_id)) with check (is_commissioner(league_id));

create policy "read shared or own courses" on courses for select
  using (league_id is null or is_league_member(league_id));
create policy "commissioners manage league courses" on courses for all
  using (league_id is not null and is_commissioner(league_id))
  with check (league_id is not null and is_commissioner(league_id));

create policy "read layouts of visible courses" on layouts for select
  using (exists (select 1 from courses c where c.id = course_id and (c.league_id is null or is_league_member(c.league_id))));
create policy "commissioners manage league layouts" on layouts for all
  using (exists (select 1 from courses c where c.id = course_id and c.league_id is not null and is_commissioner(c.league_id)))
  with check (exists (select 1 from courses c where c.id = course_id and c.league_id is not null and is_commissioner(c.league_id)));

create policy "members read seasons" on seasons for select using (is_league_member(league_id));
create policy "commissioners manage seasons" on seasons for all
  using (is_commissioner(league_id)) with check (is_commissioner(league_id));

create policy "members read events" on events for select using (is_league_member(league_id));
create policy "commissioners manage events" on events for all
  using (is_commissioner(league_id)) with check (is_commissioner(league_id));

create policy "members read rounds" on rounds for select using (is_league_member(league_id));
create policy "members start rounds" on rounds for insert with check (
  is_league_member(league_id)
  and exists (select 1 from events e where e.id = event_id and e.status in ('scheduled', 'in_progress'))
);
create policy "scorers update rounds" on rounds for update using (can_score_round(id)) with check (can_score_round(id));
create policy "commissioners delete rounds" on rounds for delete using (is_commissioner(league_id));

create policy "members read round players" on round_players for select using (is_league_member(league_id));
create policy "scorers manage round players" on round_players for all
  using (can_score_round(round_id)) with check (can_score_round(round_id));

create policy "members read scores" on hole_scores for select using (is_league_member(league_id));
create policy "scorers write scores" on hole_scores for all
  using (can_score_round(round_id)) with check (can_score_round(round_id) and entered_by = auth.uid());

create policy "members read team scores" on team_hole_scores for select using (is_league_member(league_id));
create policy "scorers write team scores" on team_hole_scores for all
  using (can_score_round(round_id)) with check (can_score_round(round_id));

create policy "members read presses" on presses for select using (is_league_member(league_id));
create policy "scorers manage presses" on presses for all
  using (can_score_round(round_id)) with check (can_score_round(round_id));

create policy "members read ctp" on ctp_reports for select using (is_league_member(league_id));
create policy "scorers report ctp" on ctp_reports for all
  using (can_score_round(round_id)) with check (can_score_round(round_id));

-- Written by settlement (service role) only.
create policy "members read ledger" on ledger_entries for select using (is_league_member(league_id));

create policy "members read payments" on payments for select using (is_league_member(league_id));
create policy "commissioners record payments" on payments for all
  using (is_commissioner(league_id)) with check (is_commissioner(league_id) and recorded_by = auth.uid());

grant execute on function create_league(text, text), accept_invite(text), request_to_join(text, text) to authenticated;
revoke execute on function create_league(text, text), accept_invite(text), request_to_join(text, text) from anon, public;
