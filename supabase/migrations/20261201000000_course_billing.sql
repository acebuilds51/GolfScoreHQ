-- Selling the Course plan, and GHIN for golfers.
--
-- 1. Staff set up a course: a club record owned by the course's manager (who
--    has signed in once), with its leagues attached. Billing is a yearly Stripe
--    invoice sent by the billing function (action 'course-invoice'), not Checkout.
-- 2. The course summary: every league at the course this season, for the
--    manager (and staff), at /course/<id>.
-- 3. Golfers add their own GHIN number, so the app can offer "Post to GHIN".

-- ── 1. Courses (staff) ───────────────────────────────────────────────────────

create function staff_create_course(p_name text, p_owner_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  cid uuid;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if length(trim(coalesce(p_name, ''))) not between 2 and 80 then raise exception 'Give the course a name.'; end if;
  select id into owner from auth.users where lower(email) = lower(trim(coalesce(p_owner_email, '')));
  if owner is null then
    raise exception 'Nobody has signed in with %. Ask the manager to sign in at golfscorehq.app once, then try again.', trim(p_owner_email);
  end if;
  insert into clubs (name, owner_id) values (trim(p_name), owner) returning id into cid;
  return cid;
end $$;

-- Put a league (by its web address name) on a course, or take it off.
create function staff_set_course_league(p_club uuid, p_slug text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  lg leagues;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select * into lg from leagues where slug = lower(trim(coalesce(p_slug, '')));
  if lg.id is null then raise exception 'No league at golfscorehq.app/l/%.', trim(p_slug); end if;
  if p_on then
    if not exists (select 1 from clubs where id = p_club) then raise exception 'That course wasn''t found.'; end if;
    if lg.plan in ('pilot', 'comp') then raise exception 'This league already has GolfScoreHQ free; it doesn''t need the Course plan.'; end if;
    update leagues set club_id = p_club, plan = 'club', plan_expires_at = null where id = lg.id;
  elsif lg.club_id = p_club then
    update leagues set club_id = null, plan = case when plan = 'club' then 'free' else plan end where id = lg.id;
  end if;
end $$;

create function staff_courses() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'expiresAt', c.plan_expires_at, 'createdAt', c.created_at,
      'ownerEmail', (select email from auth.users u where u.id = c.owner_id),
      'leagues', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'slug', l.slug) order by l.name)
                           from leagues l where l.club_id = c.id), '[]'),
      'billing', (select jsonb_build_object('status', s.status, 'periodEnd', s.current_period_end)
                  from billing_subscriptions s where s.club_id = c.id order by s.updated_at desc limit 1))
      order by c.created_at desc)
    from clubs c), '[]');
end $$;

-- ── 2. Course summary ────────────────────────────────────────────────────────

create function course_summary(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c clubs;
begin
  select * into c from clubs where id = p_club;
  if c.id is null or (c.owner_id is distinct from auth.uid() and not is_staff()) then raise exception 'That course wasn''t found.'; end if;
  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'expiresAt', c.plan_expires_at,
    'leagues', coalesce((
      select jsonb_agg(x.j order by x.j->>'name')
      from (
        select jsonb_build_object(
          'id', l.id, 'name', l.name, 'slug', l.slug,
          'golfers', (select count(*) from players p where p.league_id = l.id and p.active and not p.is_sub),
          'subs', (select count(*) from players p where p.league_id = l.id and p.active and p.is_sub),
          'onApp', (select count(*) from players p where p.league_id = l.id and p.active and p.user_id is not null),
          'season', case when s.id is null then null else coalesce(nullif(s.name, ''), s.year::text) end,
          'weeksPlayed', (select count(*) from events e where e.season_id = s.id and e.status = 'settled'),
          'weeksLeft', (select count(*) from events e where e.season_id = s.id and e.status in ('scheduled', 'in_progress')),
          'rounds', (select count(*) from round_players rp join rounds r on r.id = rp.round_id join events e on e.id = r.event_id
                     where e.season_id = s.id and e.status = 'settled'),
          'nextWeek', (select min(e.event_date) from events e where e.season_id = s.id and e.status in ('scheduled', 'in_progress') and e.event_date >= current_date),
          'lastWeek', (select max(e.event_date) from events e where e.season_id = s.id and e.status = 'settled')
        ) as j
        from leagues l
        left join lateral (select * from seasons ss where ss.league_id = l.id order by ss.year desc, ss.created_at desc limit 1) s on true
        where l.club_id = c.id
      ) x), '[]'));
end $$;

-- ── 3. A golfer's own GHIN number ────────────────────────────────────────────

create function set_my_ghin(p_player uuid, p_ghin text) returns void
language plpgsql security definer set search_path = public as $$
declare
  g text := nullif(regexp_replace(coalesce(p_ghin, ''), '\D', '', 'g'), '');
begin
  if not exists (select 1 from players where id = p_player and user_id = auth.uid()) then raise exception 'You can only change your own GHIN number.'; end if;
  if g is not null and g !~ '^[0-9]{5,10}$' then raise exception 'A GHIN number is 5 to 10 digits.'; end if;
  update players set ghin_number = g where id = p_player;
end $$;

revoke execute on function staff_create_course(text, text), staff_set_course_league(uuid, text, boolean), staff_courses(),
  course_summary(uuid), set_my_ghin(uuid, text) from anon, public;
grant execute on function staff_create_course(text, text), staff_set_course_league(uuid, text, boolean), staff_courses(),
  course_summary(uuid), set_my_ghin(uuid, text) to authenticated;
