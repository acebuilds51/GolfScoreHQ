-- Scoring support.

-- One week number per season.
alter table events add constraint events_season_week_unique unique (season_id, week_number);

-- Scorers often need to add a guest/sub on the first tee. Roster writes are
-- commissioner-only, so members add subs through this function. Reuses an
-- existing roster spot with the same name (any capitalization).
create function add_sub_player(p_league uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  nm text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  pid uuid;
begin
  if not is_league_member(p_league) then raise exception 'members only'; end if;
  if length(nm) < 1 or length(nm) > 60 then raise exception 'Enter a name up to 60 characters.'; end if;
  select id into pid from players where league_id = p_league and lower(display_name) = lower(nm) limit 1;
  if pid is not null then
    update players set active = true where id = pid and not active;
    return pid;
  end if;
  insert into players (league_id, display_name, is_sub) values (p_league, nm, true) returning id into pid;
  return pid;
end $$;

grant execute on function add_sub_player(uuid, text) to authenticated;
revoke execute on function add_sub_player(uuid, text) from anon, public;
