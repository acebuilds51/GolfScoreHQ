-- Course lookup (GolfCourseAPI) support.
--
-- course_lookup_cache keeps every search and course the lookup service has
-- returned, so each one costs a single API call no matter how many leagues
-- use it. Only the course-lookup server function (service role) touches it.

create table course_lookup_cache (
  key text primary key,
  data jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table course_lookup_cache enable row level security;
-- No policies: invisible to app users; the server function uses the service role.

-- Remember where an imported course came from.
alter table courses
  add column external_source text check (external_source in ('golfcourseapi')),
  add column external_id text;
