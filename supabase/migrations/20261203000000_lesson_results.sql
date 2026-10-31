-- Lesson results (/lessons): how far each try got, which quiz questions were
-- missed, and how it felt, so staff can see where people get stuck. One row per
-- try; the phone makes its id and saves as the person goes. Lessons are open to
-- anyone, so people who aren't signed in are counted too (no user).

create table if not exists lesson_results (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete set null,
  lesson_id text not null check (lesson_id ~ '^[a-z0-9-]{1,60}$'),
  steps int not null check (steps between 1 and 100),
  -- The furthest step reached (0 = the first).
  reached int not null default 0 check (reached between 0 and 100),
  finished boolean not null default false,
  -- Steps (0-based) of the quiz questions answered wrong.
  missed int[] not null default '{}' check (cardinality(missed) <= 50),
  right_count int check (right_count between 0 and 100),
  total_count int check (total_count between 0 and 100),
  feel text check (feel in ('easy', 'ok', 'hard')),
  idea text check (char_length(idea) <= 1000),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lesson_results_recent on lesson_results (updated_at desc);
create index if not exists lesson_results_user on lesson_results (user_id) where user_id is not null;
-- Read and written only through the functions below.
alter table lesson_results enable row level security;
revoke all on lesson_results from anon, authenticated;

-- Save a try as it goes. Only ever moves forward (furthest step, finished,
-- questions missed), so a late save can't undo a newer one, and only the
-- person who started a try can add to it.
create or replace function save_lesson_progress(
  p_id uuid, p_lesson text, p_steps int, p_reached int, p_finished boolean, p_missed int[],
  p_right int default null, p_total int default null, p_feel text default null, p_idea text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into lesson_results (id, user_id, lesson_id, steps, reached, finished, missed, right_count, total_count, feel, idea)
  values (p_id, auth.uid(), p_lesson, p_steps, least(p_reached, p_steps), p_finished, coalesce(p_missed, '{}'), p_right, p_total,
          p_feel, nullif(btrim(p_idea), ''))
  on conflict (id) do update set
    reached = greatest(lesson_results.reached, excluded.reached),
    finished = lesson_results.finished or excluded.finished,
    missed = (select coalesce(array_agg(distinct m order by m), '{}') from unnest(lesson_results.missed || excluded.missed) m),
    right_count = coalesce(excluded.right_count, lesson_results.right_count),
    total_count = coalesce(excluded.total_count, lesson_results.total_count),
    feel = coalesce(excluded.feel, lesson_results.feel),
    idea = coalesce(excluded.idea, lesson_results.idea),
    updated_at = now()
  where lesson_results.user_id is not distinct from auth.uid() and lesson_results.lesson_id = excluded.lesson_id;
end $$;

-- The signed-in person's finished lessons (their best score on each), so the
-- list shows them done on every phone.
create or replace function my_lessons() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(lesson_id, jsonb_build_object('right', right_count, 'total', total_count, 'at', updated_at)), '{}'::jsonb)
  from (
    select distinct on (lesson_id) lesson_id, right_count, total_count, updated_at
    from lesson_results
    where user_id = auth.uid() and finished
    order by lesson_id, right_count desc nulls last, updated_at desc
  ) b;
$$;

-- Staff: every try in the last p_days days (the app adds them up per lesson).
create or replace function staff_lesson_results(p_days int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'staff only'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'lessonId', r.lesson_id, 'steps', r.steps, 'reached', r.reached, 'finished', r.finished, 'missed', to_jsonb(r.missed),
      'right', r.right_count, 'total', r.total_count, 'feel', r.feel, 'idea', r.idea,
      'signedIn', r.user_id is not null, 'email', case when r.idea is not null then u.email end,
      'startedAt', r.started_at, 'updatedAt', r.updated_at
    ) order by r.updated_at desc)
    from (select * from lesson_results where updated_at > now() - make_interval(days => least(greatest(p_days, 1), 365))
          order by updated_at desc limit 5000) r
    left join auth.users u on u.id = r.user_id
  ), '[]'::jsonb);
end $$;

grant execute on function save_lesson_progress(uuid, text, int, int, boolean, int[], int, int, text, text) to anon, authenticated;
grant execute on function my_lessons() to authenticated;
grant execute on function staff_lesson_results(int) to authenticated;
revoke execute on function my_lessons(), staff_lesson_results(int) from anon, public;
