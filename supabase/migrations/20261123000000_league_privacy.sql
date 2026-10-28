-- What golfers see, set by the commissioner (from the old OCBC app).
--
--   show_money   golfers see season money (Standings, player pages, awards, the
--                recap's "season to date" line). Commissioners always do. Week
--                results still show that week's money.
--   share_emails golfers can see each other's emails on the roster (phones have
--                their own switch, share_phones). Commissioners always can.
--
-- Only commissioners can change them (the leagues update policy).
-- Settling the week stays manual, for commissioners only.

alter table leagues
  add column show_money boolean not null default true,
  add column share_emails boolean not null default false;
grant update (show_money, share_emails) on leagues to authenticated;

create function league_email_book(lid uuid) returns table (player_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select c.player_id, c.email
  from player_contacts c
  join players p on p.id = c.player_id
  join leagues l on l.id = c.league_id
  where c.league_id = lid and c.email is not null and p.active
    and (is_commissioner(lid) or (l.share_emails and is_league_member(lid)))
$$;
grant execute on function league_email_book(uuid) to authenticated;
revoke execute on function league_email_book(uuid) from anon, public;
