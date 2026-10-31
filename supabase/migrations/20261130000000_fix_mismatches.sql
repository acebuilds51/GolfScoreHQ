-- Making the app match what the site says.
--
-- 1. The Course plan is $990 a year (the plans table still had the old $299 Club price).
--    Plans are billed per year, not per season.
-- 2. The Scorer role is gone: any member can already keep score, so it did nothing.
--    Scorers become golfers.
-- 3. "Results are in" goes to golfers' phones the moment a week is settled, for
--    every league, not only when a Pro league sends the recap email.

-- ── 1. Prices ─────────────────────────────────────────────────────────────────

alter table plans drop constraint if exists plans_billing_check;
update plans set billing = case billing
  when 'per_league_season' then 'per_league_year'
  when 'per_club_season' then 'per_club_year'
  else billing end;
alter table plans add constraint plans_billing_check check (billing in ('none', 'per_league_year', 'per_club_year'));
update plans set price_cents = 99000 where code = 'club';

-- ── 2. No more Scorer role ───────────────────────────────────────────────────
-- The enum keeps the value (Postgres can't drop one), but nobody holds it.

update league_members set role = 'player' where role = 'scorer';

-- ── 3. "Results are in" ──────────────────────────────────────────────────────

create function results_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  lg leagues;
  users uuid[];
begin
  if new.status <> 'settled' or old.status is not distinct from 'settled' then return null; end if;
  select * into lg from leagues where id = new.league_id;
  -- Active golfers with the app, minus anyone who turned off weekly results.
  select coalesce(array_agg(p.user_id), '{}') into users
  from players p
  where p.league_id = new.league_id and p.active and p.user_id is not null
    and not exists (select 1 from notification_prefs n
                    where n.player_id = p.id and n.league_id = new.league_id and n.weekly_recap = false);
  perform queue_push(users, lg.name || ': week ' || new.week_number || ' results',
    'Results, skins and standings are in.', '/l/' || lg.slug || '/standings', 'results-' || new.id);
  return null;
end $$;
create trigger events_results_notify after update of status on events
  for each row execute function results_notify();

revoke execute on function results_notify() from anon, authenticated, public;
