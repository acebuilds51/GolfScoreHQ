-- Texting each other from the app.
--
-- Contact details stay commissioner-only (player_contacts). When the
-- commissioner turns on share_phones, every member of the league can also
-- read the phone numbers (never emails) through league_phone_book(), so the
-- roster can show a Text button that opens the phone's messaging app.

alter table leagues add column share_phones boolean not null default false;
grant update (share_phones) on leagues to authenticated;

create function league_phone_book(lid uuid) returns table (player_id uuid, phone text)
language sql stable security definer set search_path = public as $$
  select c.player_id, c.phone
  from player_contacts c
  join players p on p.id = c.player_id
  join leagues l on l.id = c.league_id
  where c.league_id = lid and c.phone is not null and p.active
    and (is_commissioner(lid) or (l.share_phones and is_league_member(lid)))
$$;

grant execute on function league_phone_book(uuid) to authenticated;
revoke execute on function league_phone_book(uuid) from anon, public;
