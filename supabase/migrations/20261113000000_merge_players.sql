-- Merge two roster spots that are the same golfer (e.g. duplicates from an
-- import). Everything that points at the duplicate moves to the one being
-- kept: groups and hole scores, CTPs, money, payments, RSVPs, sub offers,
-- invites, contact details, notification settings, handicap and the linked
-- app account. Then the duplicate is deleted. Commissioners only.

create function merge_players(p_keep uuid, p_drop uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  k players;
  d players;
  clash text;
begin
  if p_keep = p_drop then raise exception 'Pick two different golfers.'; end if;
  select * into k from players where id = p_keep for update;
  select * into d from players where id = p_drop for update;
  if k.id is null or d.id is null then raise exception 'Golfer not found.'; end if;
  if k.league_id <> d.league_id then raise exception 'Both golfers must be in the same league.'; end if;
  if not is_commissioner(k.league_id) then raise exception 'commissioners only'; end if;
  if k.user_id is not null and d.user_id is not null and k.user_id <> d.user_id then
    raise exception 'Both golfers have their own app accounts, so they are different people.';
  end if;

  -- Two roster spots in the same group are two different golfers.
  select 'week ' || e.week_number || ', tee time ' || r.tee_slot into clash
  from round_players a
  join round_players b on b.round_id = a.round_id
  join rounds r on r.id = a.round_id
  join events e on e.id = r.event_id
  where a.player_id = p_keep and b.player_id = p_drop
  limit 1;
  if clash is not null then
    raise exception 'They played in the same group (%), so they are different golfers.', clash;
  end if;

  -- Groups: a new spot for the kept golfer, scores moved onto it, the old spot removed.
  insert into round_players (round_id, player_id, league_id, side, position, course_handicap)
  select round_id, p_keep, league_id, side, position, course_handicap from round_players where player_id = p_drop;
  update hole_scores set player_id = p_keep where player_id = p_drop;
  delete from round_players where player_id = p_drop;

  update ctp_reports set player_id = p_keep where player_id = p_drop;
  update ctp_reports set beat_player_id = p_keep where beat_player_id = p_drop;
  -- A claim can't say a golfer beat themselves.
  update ctp_reports set beat_player_id = null where beat_player_id = player_id;
  update ctp_decisions set player_id = p_keep where player_id = p_drop;
  update ledger_entries set player_id = p_keep where player_id = p_drop;
  update payments set player_id = p_keep where player_id = p_drop;
  update invites set player_id = p_keep where player_id = p_drop;

  -- One answer per week / offer: keep the kept golfer's own where both have one.
  delete from event_rsvps x where x.player_id = p_drop and exists (select 1 from event_rsvps y where y.player_id = p_keep and y.event_id = x.event_id);
  update event_rsvps set player_id = p_keep where player_id = p_drop;
  delete from sub_offers x where x.player_id = p_drop and exists (select 1 from sub_offers y where y.player_id = p_keep and y.request_id = x.request_id);
  update sub_offers set player_id = p_keep where player_id = p_drop;

  -- Contact details: the kept golfer's, with gaps filled from the duplicate.
  if exists (select 1 from player_contacts where player_id = p_keep) then
    update player_contacts c set
      email = coalesce(c.email, (select email from player_contacts where player_id = p_drop)),
      phone = coalesce(c.phone, (select phone from player_contacts where player_id = p_drop))
    where c.player_id = p_keep;
    delete from player_contacts where player_id = p_drop;
  else
    update player_contacts set player_id = p_keep where player_id = p_drop;
  end if;
  if exists (select 1 from notification_prefs where player_id = p_keep) then
    delete from notification_prefs where player_id = p_drop;
  else
    update notification_prefs set player_id = p_keep where player_id = p_drop;
  end if;

  -- The roster spot itself: take over the app account, handicap and GHIN if the kept one has none.
  delete from players where id = p_drop;
  update players set
    -- Tidy the spacing ("Aaron  Seal " → "Aaron Seal"); duplicates often differ only by that.
    display_name = regexp_replace(trim(k.display_name), '\s+', ' ', 'g'),
    user_id = coalesce(k.user_id, d.user_id),
    handicap_index = coalesce(k.handicap_index, d.handicap_index),
    handicap_index_updated_at = case when k.handicap_index is null then d.handicap_index_updated_at else k.handicap_index_updated_at end,
    ghin_number = coalesce(k.ghin_number, d.ghin_number),
    active = k.active or d.active
  where id = p_keep;
end $$;

grant execute on function merge_players(uuid, uuid) to authenticated;
revoke execute on function merge_players(uuid, uuid) from anon, public;
