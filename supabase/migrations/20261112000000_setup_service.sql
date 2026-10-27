-- "We set up your league" (Pro).
--
-- A commissioner uploads whatever they have (spreadsheets, scorecard photos,
-- last season's export) and says what they want set up. GolfScoreHQ staff
-- get an email, download the files, join the league as a commissioner to do
-- the work, reply, and mark the request done, which removes their access.
-- Sending a request is the commissioner's consent to that temporary access.

-- ── Staff ────────────────────────────────────────────────────────────────────

-- GolfScoreHQ staff. Added by hand in the SQL editor; nobody can add themselves.
create table staff_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table staff_users enable row level security;
create policy "staff see themselves" on staff_users for select using (user_id = auth.uid());
revoke insert, update, delete on staff_users from anon, authenticated;

create function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff_users where user_id = auth.uid())
$$;
grant execute on function is_staff() to authenticated;

-- ── Requests ─────────────────────────────────────────────────────────────────

alter table setup_requests
  -- [{ "path", "name", "size" }] in the setup-uploads bucket.
  add column files jsonb not null default '[]' check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 20),
  -- What they want set up: roster, handicaps, course, history, side_games.
  add column wants text[] not null default '{}',
  add column contact_phone text check (contact_phone is null or length(contact_phone) <= 40),
  -- The commissioner agreed that support may join the league as a commissioner until the request is done.
  add column staff_access boolean not null default true,
  -- Staff's message back to the commissioner.
  add column staff_reply text check (staff_reply is null or length(staff_reply) <= 4000),
  -- The staff member who joined the league for this request (removed again when it's done).
  add column staff_user_id uuid references auth.users (id),
  add constraint setup_notes_length check (notes is null or length(notes) <= 4000);

create function touch_setup_request() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger setup_requests_touch before update on setup_requests for each row execute function touch_setup_request();

-- Commissioners can add files or notes while the request is open; doing so
-- (e.g. answering staff's question) puts it back in the queue.
create policy "commissioners update open setup requests" on setup_requests for update
  using (is_commissioner(league_id) and status in ('requested', 'needs_info'))
  with check (is_commissioner(league_id) and status = 'requested');
create policy "staff see setup requests" on setup_requests for select using (is_staff());

-- Only staff fill in the staff fields; commissioners can't move a request to another league.
create function protect_setup_staff_fields() returns trigger
language plpgsql as $$
begin
  if is_staff() then return new; end if;
  if tg_op = 'INSERT' then
    new.staff_reply := null;
    new.staff_user_id := null;
  elsif new.staff_reply is distinct from old.staff_reply or new.staff_user_id is distinct from old.staff_user_id
     or new.league_id <> old.league_id or new.requested_by <> old.requested_by or new.staff_access <> old.staff_access then
    raise exception 'Only GolfScoreHQ staff can change that.';
  end if;
  return new;
end $$;
create trigger setup_requests_staff_fields before insert or update on setup_requests for each row execute function protect_setup_staff_fields();

-- ── Files ────────────────────────────────────────────────────────────────────

-- Private bucket. Paths start with the league id: <league>/<random>-<file name>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('setup-uploads', 'setup-uploads', false, 20971520, array[
  'text/csv', 'text/plain', 'application/json', 'application/pdf',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'
])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create function can_upload_setup_file(object_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  lid uuid;
begin
  begin
    lid := split_part(object_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return is_commissioner(lid) and league_has_feature(lid, 'setup_service');
end $$;
grant execute on function can_upload_setup_file(text) to authenticated;

create policy "commissioners upload setup files" on storage.objects for insert to authenticated
  with check (bucket_id = 'setup-uploads' and can_upload_setup_file(name));
create policy "commissioners and staff read setup files" on storage.objects for select to authenticated
  using (bucket_id = 'setup-uploads' and (can_upload_setup_file(name) or is_staff()));
create policy "commissioners remove setup files" on storage.objects for delete to authenticated
  using (bucket_id = 'setup-uploads' and can_upload_setup_file(name));

-- ── Staff tools ──────────────────────────────────────────────────────────────

-- Every request with its league, for the staff queue.
create function staff_setup_queue() returns table (
  id uuid, league_id uuid, league_name text, league_slug text, league_plan text,
  requested_by_email text, notes text, wants text[], files jsonb, contact_phone text, staff_access boolean,
  status text, staff_reply text, staff_user_id uuid, created_at timestamptz, updated_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return query
    select r.id, r.league_id, l.name, l.slug, l.plan::text, u.email::text, r.notes, r.wants, r.files, r.contact_phone, r.staff_access,
           r.status, r.staff_reply, r.staff_user_id, r.created_at, r.updated_at
    from setup_requests r
    join leagues l on l.id = r.league_id
    left join auth.users u on u.id = r.requested_by
    order by (r.status = 'done'), r.created_at desc;
end $$;

-- Join the league as a commissioner to do the setup (only with the commissioner's consent, while the request is open).
create function staff_join_league(p_request uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  req setup_requests;
  slug text;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select * into req from setup_requests where id = p_request for update;
  if req.id is null then raise exception 'no such request'; end if;
  if not req.staff_access then raise exception 'This commissioner didn''t give support access to the league.'; end if;
  if req.status = 'done' then raise exception 'This request is done.'; end if;
  insert into league_members (league_id, user_id, role) values (req.league_id, auth.uid(), 'commissioner')
  on conflict (league_id, user_id) do update set role = case when league_members.role = 'owner' then 'owner'::member_role else 'commissioner'::member_role end;
  update setup_requests set staff_user_id = auth.uid(), status = case when status = 'requested' then 'in_progress' else status end where id = p_request;
  select l.slug into slug from leagues l where l.id = req.league_id;
  return slug;
end $$;

-- Change a request's status and reply. Marking it done takes away the access staff got for it.
create function staff_update_setup_request(p_request uuid, p_status text, p_reply text) returns void
language plpgsql security definer set search_path = public as $$
declare
  req setup_requests;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  select * into req from setup_requests where id = p_request for update;
  if req.id is null then raise exception 'no such request'; end if;
  update setup_requests set status = p_status, staff_reply = nullif(trim(p_reply), '') where id = p_request;
  if p_status = 'done' and req.staff_user_id is not null then
    -- Leave the league again, unless that staff member also belongs to it for some other reason (e.g. as its owner).
    delete from league_members m
    where m.league_id = req.league_id and m.user_id = req.staff_user_id and m.role = 'commissioner'
      and not exists (select 1 from setup_requests o where o.league_id = req.league_id and o.id <> req.id and o.staff_user_id = req.staff_user_id and o.status <> 'done');
  end if;
end $$;

grant execute on function staff_setup_queue(), staff_join_league(uuid), staff_update_setup_request(uuid, text, text) to authenticated;
revoke execute on function staff_setup_queue(), staff_join_league(uuid), staff_update_setup_request(uuid, text, text) from anon, public;
