-- "Ideas and questions": anyone signed in sends GolfScoreHQ an idea, or a
-- question for a person (setup help, how their league should work, or one the
-- Ask helper couldn't answer). Staff get a phone notification for each one,
-- set a status and reply on /staff; the sender gets a notification when
-- there's a reply or their idea is planned or done, and sees it all on /feedback.

create table feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  league_id uuid references leagues (id) on delete set null,
  kind text not null check (kind in ('idea', 'question')),
  message text not null check (char_length(message) between 5 and 4000),
  -- The page they sent it from.
  path text,
  status text not null default 'new' check (status in ('new', 'planned', 'done', 'not_now', 'answered')),
  reply text check (char_length(reply) <= 4000),
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index feedback_recent on feedback (created_at desc);
create index feedback_user on feedback (user_id, created_at desc);
alter table feedback enable row level security;
revoke all on feedback from anon, authenticated;

-- Send an idea or a question. Returns its id.
create function send_feedback(p_kind text, p_message text, p_league_slug text default null, p_path text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  msg text := trim(coalesce(p_message, ''));
  lg uuid;
  new_id uuid;
begin
  if me is null then raise exception 'Sign in to send this.'; end if;
  if p_kind not in ('idea', 'question') then raise exception 'Pick idea or question.'; end if;
  if char_length(msg) < 5 then raise exception 'Write a little more so we know what you mean.'; end if;
  if (select count(*) from feedback where user_id = me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'That''s a lot for one day. We''ll read these first; send more tomorrow.';
  end if;
  if p_league_slug is not null then
    select id into lg from leagues where slug = p_league_slug and is_league_member(id);
  end if;
  insert into feedback (user_id, league_id, kind, message, path)
  values (me, lg, p_kind, left(msg, 4000), left(p_path, 300))
  returning id into new_id;

  perform queue_push(array(select user_id from staff_users),
    case when p_kind = 'idea' then 'New idea' else 'New question for you' end,
    left(msg, 140), '/staff#feedback', 'feedback');
  return new_id;
end $$;

-- What you've sent, newest first, with any reply.
create function my_feedback() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(f order by f.created_at desc), '[]'::jsonb) from (
    select x.id, x.kind, x.message, x.status, x.reply, x.replied_at, x.created_at, l.name as league_name
    from feedback x left join leagues l on l.id = x.league_id
    where x.user_id = auth.uid()
    order by x.created_at desc
    limit 50
  ) f
$$;

-- Staff: everything sent in the last p_days, with who sent it and their league.
create function staff_feedback(p_days int default 90) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((
    select jsonb_agg(f order by f.created_at desc) from (
      select x.id, x.kind, x.message, x.status, x.reply, x.replied_at, x.created_at, x.path, u.email, l.name as league_name
      from feedback x
      left join auth.users u on u.id = x.user_id
      left join leagues l on l.id = x.league_id
      where x.created_at > now() - make_interval(days => least(greatest(p_days, 1), 365))
      order by x.created_at desc
      limit 300
    ) f), '[]'::jsonb);
end $$;

-- Staff: set the status and the reply. The sender gets a notification for a
-- new or changed reply, or when their idea becomes planned or done.
create function staff_answer_feedback(p_id uuid, p_status text, p_reply text) returns void
language plpgsql security definer set search_path = public as $$
declare
  f feedback;
  r text := nullif(trim(coalesce(p_reply, '')), '');
  what text;
begin
  if not is_staff() then raise exception 'staff only'; end if;
  if p_status not in ('new', 'planned', 'done', 'not_now', 'answered') then raise exception 'Unknown status.'; end if;
  select * into f from feedback where id = p_id;
  if not found then raise exception 'Not found.'; end if;
  update feedback set status = p_status, reply = left(r, 4000), updated_at = now(),
    replied_at = case when r is distinct from f.reply then (case when r is null then null else now() end) else replied_at end
  where id = p_id;

  what := case when f.kind = 'idea' then 'idea' else 'question' end;
  if r is not null and r is distinct from f.reply then
    perform queue_push(array[f.user_id], 'GolfScoreHQ answered your ' || what, left(r, 140), '/feedback', 'feedback-' || p_id);
  elsif f.kind = 'idea' and p_status in ('planned', 'done') and p_status is distinct from f.status then
    perform queue_push(array[f.user_id],
      case when p_status = 'planned' then 'Your idea is on the list' else 'Your idea is in the app' end,
      left(f.message, 140), '/feedback', 'feedback-' || p_id);
  end if;
end $$;

grant execute on function send_feedback(text, text, text, text), my_feedback(), staff_feedback(int), staff_answer_feedback(uuid, text, text) to authenticated;
revoke execute on function send_feedback(text, text, text, text), my_feedback(), staff_feedback(int), staff_answer_feedback(uuid, text, text) from anon, public;
