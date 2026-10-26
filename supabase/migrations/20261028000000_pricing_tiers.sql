-- Pricing tiers are by feature, never by league size: every plan allows
-- unlimited golfers.
--
--   Free   $0                          scoring, live leaderboard, standings, roster,
--                                      invites, handicaps, basic formats, current season
--   Pro    $149 per league per season  + side games & money, dues/payout tracking,
--                                      all formats & special weeks, lineup, all seasons,
--                                      co-commissioners, export, league branding
--   Club   $299 per season, 5 leagues  Pro for every league in the club
--                                      + multi-league dashboard, priority support
--   pilot  Pro features, no charge (2027 pilot leagues)
--   comp   Club features, free forever
--
-- Prices here drive the app's pricing page; Stripe holds the billable prices.
-- Features are enforced in the database so a client can't bypass them.

alter type league_plan rename value 'league' to 'pro';

-- Size is no longer a factor.
drop trigger players_plan_limit on players;
drop function enforce_player_limit();
drop function plan_player_limit(league_plan);

-- ── Plan catalog ─────────────────────────────────────────────────────────────

create table plans (
  code league_plan primary key,
  name text not null,
  price_cents integer not null check (price_cents >= 0),
  billing text not null check (billing in ('none', 'per_league_season', 'per_club_season')),
  max_leagues smallint,
  features text[] not null
);

insert into plans (code, name, price_cents, billing, max_leagues, features) values
  ('free',  'Free',          0,     'none',              null, array[]::text[]),
  ('pro',   'Pro',           14900, 'per_league_season', null, array['side_games', 'payments', 'all_formats', 'lineup', 'history', 'co_commissioners', 'export', 'branding']),
  ('club',  'Club',          29900, 'per_club_season',   5,    array['side_games', 'payments', 'all_formats', 'lineup', 'history', 'co_commissioners', 'export', 'branding', 'multi_league', 'priority_support']),
  ('pilot', 'Pilot',         0,     'none',              null, array['side_games', 'payments', 'all_formats', 'lineup', 'history', 'co_commissioners', 'export', 'branding']),
  ('comp',  'Complimentary', 0,     'none',              null, array['side_games', 'payments', 'all_formats', 'lineup', 'history', 'co_commissioners', 'export', 'branding', 'multi_league', 'priority_support']);

alter table plans enable row level security;
create policy "anyone reads plans" on plans for select using (true);
revoke insert, update, delete on plans from anon, authenticated;

-- ── Clubs (one Club subscription covers up to 5 leagues) ────────────────────

create table clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users (id),
  plan_expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table clubs enable row level security;
create policy "owner reads club" on clubs for select using (owner_id = auth.uid());
revoke insert, update, delete on clubs from anon, authenticated;

-- Set by the billing webhook (service role), never by users.
alter table leagues add column club_id uuid references clubs (id) on delete set null;
create index on leagues (club_id);

create function enforce_club_league_limit() returns trigger
language plpgsql as $$
declare
  lim int;
begin
  if new.club_id is null then return new; end if;
  select max_leagues into lim from plans where code = 'club';
  if (select count(*) from leagues where club_id = new.club_id and id <> new.id) >= lim then
    raise exception 'plan_limit: a Club covers up to % leagues', lim using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger leagues_club_limit
before insert or update of club_id on leagues
for each row execute function enforce_club_league_limit();

-- ── Effective plan & feature checks ─────────────────────────────────────────

-- A lapsed Pro/pilot league, or a Club league whose club lapsed, falls back to
-- Free. Nothing is deleted; Pro data is just hidden or read-only until renewal.
create function effective_plan(lid uuid) returns league_plan
language sql stable security definer set search_path = public as $$
  select case
    when l.plan in ('pro', 'pilot') and l.plan_expires_at is not null and l.plan_expires_at < now() then 'free'::league_plan
    when l.plan = 'club' and (c.id is null or (c.plan_expires_at is not null and c.plan_expires_at < now())) then 'free'::league_plan
    else l.plan
  end
  from leagues l left join clubs c on c.id = l.club_id
  where l.id = lid
$$;

create function league_has_feature(lid uuid, feature text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select feature = any (p.features) from plans p where p.code = effective_plan(lid)), false)
$$;

create function require_feature(lid uuid, feature text, label text) returns void
language plpgsql stable as $$
begin
  if not league_has_feature(lid, feature) then
    raise exception 'plan_feature: % needs GolfScoreHQ Pro', label using errcode = 'P0001';
  end if;
end $$;

-- Rules (engine FormatRules JSON) that involve money or side games.
create function rules_use_side_games(r jsonb) returns boolean
language sql immutable as $$
  select coalesce((r #>> '{skins,enabled}')::boolean, false)
      or coalesce((r #>> '{ctp,enabled}')::boolean, false)
      or coalesce((r #>> '{presses,enabled}')::boolean, false)
      or coalesce((r #>> '{match,stake}')::numeric, 0) > 0
      or coalesce((r ->> 'teamPot')::numeric, 0) > 0
$$;

-- Formats available on Free.
create function rules_are_basic_format(r jsonb) returns boolean
language sql immutable as $$
  select coalesce(r ->> 'format', '') in ('bestBallMatch', 'strokePlay')
$$;

create function enforce_season_rules_plan() returns trigger
language plpgsql as $$
begin
  if not rules_are_basic_format(new.rules) then
    perform require_feature(new.league_id, 'all_formats', 'This format');
  end if;
  if rules_use_side_games(new.rules) then
    perform require_feature(new.league_id, 'side_games', 'Side games and money');
  end if;
  return new;
end $$;

create trigger seasons_rules_plan
before insert or update of rules on seasons
for each row execute function enforce_season_rules_plan();

create function enforce_event_override_plan() returns trigger
language plpgsql as $$
begin
  if new.rules_override is not null then
    perform require_feature(new.league_id, 'all_formats', 'Special weeks');
    if rules_use_side_games(new.rules_override) then
      perform require_feature(new.league_id, 'side_games', 'Side games and money');
    end if;
  end if;
  return new;
end $$;

create trigger events_override_plan
before insert or update of rules_override on events
for each row execute function enforce_event_override_plan();

create function enforce_member_role_plan() returns trigger
language plpgsql as $$
begin
  if new.role = 'commissioner' then
    perform require_feature(new.league_id, 'co_commissioners', 'Co-commissioners');
  end if;
  return new;
end $$;

create trigger league_members_role_plan
before insert or update of role on league_members
for each row execute function enforce_member_role_plan();

create function enforce_branding_plan() returns trigger
language plpgsql as $$
begin
  if new.logo_url is not null and new.logo_url is distinct from old.logo_url then
    perform require_feature(new.id, 'branding', 'A league logo');
  end if;
  return new;
end $$;

create trigger leagues_branding_plan
before update of logo_url on leagues
for each row execute function enforce_branding_plan();

-- ── Season history (Free sees the current season only) ──────────────────────

-- Takes the season's own columns (not just its id) so it also works on a row
-- that is being inserted, which a lookup by id can't see yet.
create function season_row_visible(lid uuid, yr smallint, created timestamptz, sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_league_member(lid)
     and (
       league_has_feature(lid, 'history')
       or not exists (
         select 1 from seasons s2
         where s2.league_id = lid and s2.id <> sid
           and (s2.year > yr or (s2.year = yr and s2.created_at > created))
       )
     )
$$;

create function season_visible(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from seasons s where s.id = sid and season_row_visible(s.league_id, s.year, s.created_at, s.id))
$$;

create function event_visible(eid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from events e where e.id = eid and season_visible(e.season_id))
$$;

create function round_visible(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from rounds r where r.id = rid and event_visible(r.event_id))
$$;

-- ── Policies: reads respect history, writes respect features ────────────────
-- "for all" policies also grant SELECT, which would bypass the history rule,
-- so write access is split into insert/update/delete.

drop policy "members read seasons" on seasons;
drop policy "commissioners manage seasons" on seasons;
create policy "members read visible seasons" on seasons for select using (season_row_visible(league_id, year, created_at, id));
create policy "commissioners add seasons" on seasons for insert with check (is_commissioner(league_id));
create policy "commissioners edit seasons" on seasons for update using (is_commissioner(league_id)) with check (is_commissioner(league_id));
create policy "commissioners remove seasons" on seasons for delete using (is_commissioner(league_id));

drop policy "members read events" on events;
drop policy "commissioners manage events" on events;
create policy "members read visible events" on events for select using (season_visible(season_id));
create policy "commissioners add events" on events for insert with check (is_commissioner(league_id));
create policy "commissioners edit events" on events for update using (is_commissioner(league_id)) with check (is_commissioner(league_id));
create policy "commissioners remove events" on events for delete using (is_commissioner(league_id));

drop policy "members read rounds" on rounds;
create policy "members read visible rounds" on rounds for select using (event_visible(event_id));

drop policy "members read round players" on round_players;
drop policy "scorers manage round players" on round_players;
create policy "members read visible round players" on round_players for select using (round_visible(round_id));
create policy "scorers add round players" on round_players for insert with check (can_score_round(round_id));
create policy "scorers edit round players" on round_players for update using (can_score_round(round_id)) with check (can_score_round(round_id));
create policy "scorers remove round players" on round_players for delete using (can_score_round(round_id));

drop policy "members read scores" on hole_scores;
drop policy "scorers write scores" on hole_scores;
create policy "members read visible scores" on hole_scores for select using (round_visible(round_id));
create policy "scorers add scores" on hole_scores for insert with check (can_score_round(round_id) and entered_by = auth.uid());
create policy "scorers edit scores" on hole_scores for update using (can_score_round(round_id)) with check (can_score_round(round_id) and entered_by = auth.uid());
create policy "scorers remove scores" on hole_scores for delete using (can_score_round(round_id));

drop policy "members read team scores" on team_hole_scores;
drop policy "scorers write team scores" on team_hole_scores;
create policy "members read visible team scores" on team_hole_scores for select using (round_visible(round_id));
create policy "scorers add team scores" on team_hole_scores for insert with check (can_score_round(round_id));
create policy "scorers edit team scores" on team_hole_scores for update using (can_score_round(round_id)) with check (can_score_round(round_id));
create policy "scorers remove team scores" on team_hole_scores for delete using (can_score_round(round_id));

drop policy "members read presses" on presses;
drop policy "scorers manage presses" on presses;
create policy "members read visible presses" on presses for select using (round_visible(round_id));
create policy "scorers add presses" on presses for insert with check (can_score_round(round_id) and league_has_feature(league_id, 'side_games'));
create policy "scorers edit presses" on presses for update using (can_score_round(round_id)) with check (can_score_round(round_id) and league_has_feature(league_id, 'side_games'));
create policy "scorers remove presses" on presses for delete using (can_score_round(round_id));

drop policy "members read ctp" on ctp_reports;
drop policy "scorers report ctp" on ctp_reports;
create policy "members read visible ctp" on ctp_reports for select using (round_visible(round_id));
create policy "scorers add ctp" on ctp_reports for insert with check (can_score_round(round_id) and league_has_feature(league_id, 'side_games'));
create policy "scorers edit ctp" on ctp_reports for update using (can_score_round(round_id)) with check (can_score_round(round_id) and league_has_feature(league_id, 'side_games'));
create policy "scorers remove ctp" on ctp_reports for delete using (can_score_round(round_id));

drop policy "members read ledger" on ledger_entries;
create policy "members read visible ledger" on ledger_entries for select using (event_visible(event_id));

drop policy "commissioners manage payment handles" on league_payment_settings;
create policy "commissioners add payment handles" on league_payment_settings for insert
  with check (is_commissioner(league_id) and league_has_feature(league_id, 'payments'));
create policy "commissioners edit payment handles" on league_payment_settings for update
  using (is_commissioner(league_id)) with check (is_commissioner(league_id) and league_has_feature(league_id, 'payments'));
create policy "commissioners remove payment handles" on league_payment_settings for delete using (is_commissioner(league_id));

drop policy "commissioners record payments" on payments;
create policy "commissioners add payments" on payments for insert
  with check (is_commissioner(league_id) and recorded_by = auth.uid() and league_has_feature(league_id, 'payments'));
create policy "commissioners edit payments" on payments for update
  using (is_commissioner(league_id)) with check (is_commissioner(league_id) and league_has_feature(league_id, 'payments'));
create policy "commissioners remove payments" on payments for delete using (is_commissioner(league_id));

grant execute on function league_has_feature(uuid, text), effective_plan(uuid) to authenticated;
