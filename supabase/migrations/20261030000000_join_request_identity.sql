-- Commissioners need to see who is asking to join. Profiles are private to
-- their owner, so the request carries the requester's email and name.

alter table join_requests
  add column requester_email text,
  add column requester_name text;

drop function request_to_join(text, text);

create function request_to_join(p_code text, p_message text default null, p_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  lid uuid;
  em text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into lid from leagues where join_code = upper(trim(p_code));
  if lid is null then raise exception 'no league with that code'; end if;
  if exists (select 1 from league_members where league_id = lid and user_id = auth.uid()) then
    return lid;
  end if;
  select email into em from auth.users where id = auth.uid();
  insert into join_requests (league_id, user_id, message, requester_email, requester_name)
  values (lid, auth.uid(), p_message, em, nullif(trim(p_name), ''))
  on conflict (league_id, user_id) do update
    set status = 'pending', message = excluded.message,
        requester_email = excluded.requester_email, requester_name = excluded.requester_name;
  return lid;
end $$;

grant execute on function request_to_join(text, text, text) to authenticated;
revoke execute on function request_to_join(text, text, text) from anon, public;

-- Approving a request: add the member and mark the request, in one step.
create function decide_join_request(p_league uuid, p_user uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_commissioner(p_league) then raise exception 'commissioners only'; end if;
  update join_requests set status = case when p_approve then 'approved' else 'declined' end
  where league_id = p_league and user_id = p_user and status = 'pending';
  if not found then raise exception 'no pending request'; end if;
  if p_approve then
    insert into league_members (league_id, user_id, role) values (p_league, p_user, 'player')
    on conflict (league_id, user_id) do nothing;
  end if;
end $$;

grant execute on function decide_join_request(uuid, uuid, boolean) to authenticated;
revoke execute on function decide_join_request(uuid, uuid, boolean) from anon, public;
