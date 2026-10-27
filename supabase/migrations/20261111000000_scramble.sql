-- Scramble.
--
-- A scramble can be the season's format or one special week in another
-- format (events.rules_override, e.g. OCBC's week 14 scramble). Each team
-- enters one score per hole; the app saves it for every player in the group,
-- so live scoring, offline sync and the TV work unchanged. Scramble prize
-- money is posted as 'scramblePot' entries, which settle_event already allows.

-- Clubhouse TV needs the week's own rules so a scramble week shows teams.
create or replace function tv_feed(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d tv_displays;
  lg leagues;
  s seasons;
  ev events;
  lay layouts;
  course_name text;
  branded boolean;
begin
  if p_token is null or length(p_token) < 16 or length(p_token) > 128 then return null; end if;
  select * into d from tv_displays
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and revoked_at is null;
  if d.id is null then return null; end if;

  select * into lg from leagues where id = d.league_id;
  if not league_has_feature(lg.id, 'tv_mode') then
    return jsonb_build_object('error', 'plan', 'league', jsonb_build_object('name', lg.name));
  end if;
  branded := league_has_feature(lg.id, 'branding');

  select * into s from seasons where league_id = lg.id order by year desc, created_at desc limit 1;
  if s.id is not null then
    -- The week being played: the latest open week with groups on it,
    -- otherwise the latest week of the season.
    select e.* into ev from events e
    where e.season_id = s.id and e.status in ('scheduled', 'in_progress')
      and exists (select 1 from rounds r where r.event_id = e.id)
    order by e.week_number desc limit 1;
    if ev.id is null then
      select e.* into ev from events e where e.season_id = s.id order by e.week_number desc limit 1;
    end if;
  end if;
  if ev.id is not null and ev.layout_id is not null then
    select * into lay from layouts where id = ev.layout_id;
    select c.name into course_name from courses c where c.id = lay.course_id;
  end if;

  return jsonb_build_object(
    'league', jsonb_build_object(
      'name', lg.name, 'slug', lg.slug,
      'logoUrl', case when branded then lg.logo_url end,
      'brandColor', case when branded then lg.brand_color end,
      'accentColor', case when branded then lg.accent_color end),
    'display', jsonb_build_object('name', d.name, 'settings', d.settings),
    'season', case when s.id is null then null else jsonb_build_object('year', s.year, 'name', s.name, 'rules', s.rules) end,
    'event', case when ev.id is null then null else jsonb_build_object('id', ev.id, 'weekNumber', ev.week_number, 'eventDate', ev.event_date, 'status', ev.status, 'rulesOverride', ev.rules_override) end,
    'layout', case when lay.id is null then null else jsonb_build_object(
      'id', lay.id, 'name', lay.name, 'tees', lay.tees, 'holes', lay.holes, 'rating', lay.rating, 'slope', lay.slope, 'courseName', course_name) end,
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'displayName', p.display_name, 'isSub', p.is_sub)), '[]')
      from players p where p.league_id = lg.id
    ),
    'rounds', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'eventId', r.event_id, 'teeSlot', r.tee_slot, 'status', r.status, 'currentHole', r.current_hole,
        'submittedAt', r.submitted_at, 'presses', '[]'::jsonb,
        'players', (
          select coalesce(jsonb_agg(jsonb_build_object('playerId', rp.player_id, 'side', rp.side, 'position', rp.position, 'courseHandicap', rp.course_handicap) order by rp.position), '[]')
          from round_players rp where rp.round_id = r.id
        ),
        'scores', (
          select coalesce(jsonb_object_agg(x.player_id, x.holes), '{}')
          from (select hs.player_id, jsonb_object_agg(hs.hole_number, hs.strokes) as holes
                from hole_scores hs where hs.round_id = r.id group by hs.player_id) x
        ),
        'ctp', (
          select coalesce(jsonb_object_agg(c.hole_number, jsonb_build_object('playerId', c.player_id, 'beat', c.beat_player_id)), '{}')
          from ctp_reports c where c.round_id = r.id
        )
      ) order by r.tee_slot), '[]')
      from rounds r where ev.id is not null and r.event_id = ev.id
    ),
    'standings', (
      select coalesce(jsonb_agg(jsonb_build_object('playerId', t.player_id, 'money', t.money, 'skins', t.skins, 'ctps', t.ctps) order by t.money desc), '[]')
      from (
        select le.player_id, sum(le.amount_cents) as money,
               count(*) filter (where le.kind = 'skin') as skins,
               count(*) filter (where le.kind = 'ctp') as ctps
        from ledger_entries le join events e on e.id = le.event_id
        where s.id is not null and e.season_id = s.id and e.status = 'settled'
        group by le.player_id
      ) t
    ),
    'generatedAt', now()
  );
end $$;

