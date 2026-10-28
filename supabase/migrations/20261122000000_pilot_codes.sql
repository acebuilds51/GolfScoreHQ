-- Pilot sign-up: staff make a code (one per league they're recruiting), send
-- the link golfscorehq.app/pilot/<code>, and the commissioner who opens it
-- starts a new league, or switches an existing free one, onto the free pilot
-- plan (every Pro feature through the 2027 season). No hand edits in the
-- database.

create table pilot_codes (
  code text primary key check (code ~ '^[A-Z0-9-]{4,24}$'),
  -- Who it's for, e.g. "Crystal Lake Tuesday men's league".
  note text check (length(note) <= 120),
  max_uses smallint not null default 1 check (max_uses between 1 and 50),
  uses smallint not null default 0,
  -- The pilot plan lasts until this date.
  pilot_until timestamptz not null default '2028-01-01',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table pilot_redemptions (
  league_id uuid primary key references leagues (id) on delete cascade,
  code text not null references pilot_codes (code),
  redeemed_by uuid not null references auth.users (id),
  redeemed_at timestamptz not null default now()
);

alter table pilot_codes enable row level security;
alter table pilot_redemptions enable row level security;
create policy "staff read pilot codes" on pilot_codes for select using (is_staff());
create policy "staff read pilot redemptions" on pilot_redemptions for select using (is_staff());
revoke insert, update, delete on pilot_codes, pilot_redemptions from anon, authenticated;

-- 'ok', 'used' (no uses left), 'ended' (revoked or past its date) or 'invalid'.
create function pilot_code_status(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when c.code is null then 'invalid'
    when c.revoked_at is not null or c.pilot_until < now() then 'ended'
    when c.uses >= c.max_uses then 'used'
    else 'ok'
  end
  from (select 1) one left join pilot_codes c on c.code = upper(trim(coalesce(p_code, '')))
$$;
grant execute on function pilot_code_status(text) to anon, authenticated;

-- Use up one of the code's uses (locked, so two commissioners can't take the last one).
create function pilot_take(p_code text) returns pilot_codes
language plpgsql security definer set search_path = public as $$
declare
  c pilot_codes;
begin
  select * into c from pilot_codes where code = upper(trim(coalesce(p_code, ''))) for update;
  if c.code is null then raise exception 'That pilot code isn''t right. Check the link you were sent.'; end if;
  if c.revoked_at is not null or c.pilot_until < now() then raise exception 'That pilot code has ended.'; end if;
  if c.uses >= c.max_uses then raise exception 'That pilot code has already been used.'; end if;
  update pilot_codes set uses = uses + 1 where code = c.code;
  return c;
end $$;
revoke execute on function pilot_take(text) from anon, authenticated, public;

-- An existing league (its commissioner, on the free plan) joins the pilot.
create function redeem_pilot_code(p_code text, p_league uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c pilot_codes;
  lg leagues;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into lg from leagues where id = p_league for update;
  if lg.id is null or not is_commissioner(lg.id) then raise exception 'Only the league''s commissioner can use a pilot code.'; end if;
  if effective_plan(lg.id) <> 'free' then raise exception 'This league already has Pro features.'; end if;
  c := pilot_take(p_code);
  update leagues set plan = 'pilot', plan_expires_at = c.pilot_until, club_id = null where id = lg.id;
  insert into pilot_redemptions (league_id, code, redeemed_by) values (lg.id, c.code, auth.uid());
end $$;

-- A new league that starts on the pilot plan (doesn't use up the free league).
create function create_pilot_league(p_code text, p_name text, p_slug text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c pilot_codes;
  lid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  c := pilot_take(p_code);
  insert into leagues (name, slug, owner_id, plan, plan_expires_at) values (p_name, p_slug, auth.uid(), 'pilot', c.pilot_until) returning id into lid;
  insert into league_members (league_id, user_id, role) values (lid, auth.uid(), 'owner');
  insert into pilot_redemptions (league_id, code, redeemed_by) values (lid, c.code, auth.uid());
  return lid;
end $$;

-- Staff: a new code ("PILOT-7F3A9C"), for one league unless they say otherwise.
create function create_pilot_code(p_note text, p_max_uses smallint default 1) returns text
language plpgsql security definer set search_path = public as $$
declare
  c text;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  loop
    c := 'PILOT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from pilot_codes where code = c);
  end loop;
  insert into pilot_codes (code, note, max_uses, created_by) values (c, nullif(trim(p_note), ''), p_max_uses, auth.uid());
  return c;
end $$;

create function revoke_pilot_code(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  update pilot_codes set revoked_at = now() where code = p_code and revoked_at is null;
end $$;

-- Staff: every code, newest first, with the leagues that used it.
create function staff_pilot_codes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', c.code, 'note', c.note, 'maxUses', c.max_uses, 'uses', c.uses, 'pilotUntil', c.pilot_until,
      'createdAt', c.created_at, 'revokedAt', c.revoked_at,
      'leagues', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'slug', l.slug) order by r.redeemed_at)
                           from pilot_redemptions r join leagues l on l.id = r.league_id where r.code = c.code), '[]'))
      order by c.created_at desc)
    from pilot_codes c), '[]');
end $$;

grant execute on function redeem_pilot_code(text, uuid), create_pilot_league(text, text, text), create_pilot_code(text, smallint), revoke_pilot_code(text), staff_pilot_codes() to authenticated;
revoke execute on function redeem_pilot_code(text, uuid), create_pilot_league(text, text, text), create_pilot_code(text, smallint), revoke_pilot_code(text), staff_pilot_codes() from anon, public;
