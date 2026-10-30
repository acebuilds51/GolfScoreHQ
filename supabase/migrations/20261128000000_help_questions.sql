-- "Ask a question" on the Help page. The ask-help server function saves each
-- question and the answer it gave (null when it couldn't answer), so staff can
-- see what people get stuck on and fill the gaps in the Help page. The person
-- who asked can say whether the answer helped.

create table help_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  league_id uuid references leagues (id) on delete set null,
  question text not null check (char_length(question) <= 600),
  answer text,
  -- How many messages were in the conversation (1 = a first question, more = a follow-up).
  turn int not null default 1,
  helpful boolean,
  created_at timestamptz not null default now()
);
create index help_questions_recent on help_questions (created_at desc);
create index help_questions_user on help_questions (user_id, created_at desc);
alter table help_questions enable row level security;
revoke all on help_questions from anon, authenticated;

-- "Did this help?" on an answer: only the person who asked.
create function rate_help_answer(p_id uuid, p_helpful boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update help_questions set helpful = p_helpful where id = p_id and user_id = auth.uid();
end $$;

-- Staff: recent questions, newest first, with who asked and their league.
create function staff_help_questions(p_days int default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((
    select jsonb_agg(q order by q.created_at desc) from (
      select h.id, h.question, h.answer, h.turn, h.helpful, h.created_at, u.email, l.name as league_name
      from help_questions h
      left join auth.users u on u.id = h.user_id
      left join leagues l on l.id = h.league_id
      where h.created_at > now() - make_interval(days => least(greatest(p_days, 1), 365))
      order by h.created_at desc
      limit 300
    ) q), '[]'::jsonb);
end $$;

grant execute on function rate_help_answer(uuid, boolean), staff_help_questions(int) to authenticated;
revoke execute on function rate_help_answer(uuid, boolean), staff_help_questions(int) from anon, public;
