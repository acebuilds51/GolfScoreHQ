-- Clubhouse TV sponsor slot (Club plan): a sponsor's name, a short line and an
-- optional logo, shown as its own screen in the rotation and along the bottom.
-- Stored in the TV link's settings ("sponsor"); this keeps it to Club leagues
-- and keeps it short.

create function enforce_tv_sponsor() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s jsonb := new.settings -> 'sponsor';
begin
  if s is null or jsonb_typeof(s) = 'null' then return new; end if;
  if tg_op = 'UPDATE' and s = old.settings -> 'sponsor' then return new; end if;
  if not league_has_feature(new.league_id, 'multi_league') then
    raise exception 'plan_feature: A TV sponsor needs the Club plan' using errcode = 'P0001';
  end if;
  if jsonb_typeof(s) <> 'object' or length(coalesce(s ->> 'name', '')) not between 1 and 60
     or length(coalesce(s ->> 'message', '')) > 140
     or (coalesce(s ->> 'logoUrl', '') <> '' and (s ->> 'logoUrl') !~ '^https://' or length(coalesce(s ->> 'logoUrl', '')) > 500) then
    raise exception 'Sponsor: a name (up to 60 characters), a line up to 140, and a logo link starting with https://.';
  end if;
  return new;
end $$;

create trigger tv_displays_sponsor before insert or update of settings on tv_displays
  for each row execute function enforce_tv_sponsor();
