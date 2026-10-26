// Course lookup server function.
//
//   POST { action: 'search', query: 'shepherds hollow' } → { courses: CourseSummary[] }
//   POST { action: 'course', id: '...' }                → { course: LookupCourse }
//
// Signed-in users only. The GolfCourseAPI key lives in the function's secrets
// (GOLFCOURSEAPI_KEY) and never reaches the browser. Results are cached in
// course_lookup_cache so each search or course is fetched from the service once.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { normalizeCourse, normalizeSearch } from './normalize.ts';

const API = 'https://api.golfcourseapi.com/v1';
const SEARCH_TTL_DAYS = 30;
const COURSE_TTL_DAYS = 180;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const env = (k: string) => Deno.env.get(k) ?? '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) return json({ error: 'Sign in first.' }, 401);

  const key = env('GOLFCOURSEAPI_KEY');
  if (!key) return json({ error: "Course lookup isn't set up yet. Enter the pars by hand for now." }, 503);

  let body: { action?: string; query?: string; id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request.' }, 400);
  }

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

  async function cached(cacheKey: string, ttlDays: number, path: string) {
    const { data: hit } = await admin.from('course_lookup_cache').select('data, fetched_at').eq('key', cacheKey).maybeSingle();
    if (hit && Date.now() - new Date(hit.fetched_at).getTime() < ttlDays * 864e5) return { data: hit.data, status: 200 };
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return { data: null, status: res.status };
    const data = await res.json();
    await admin.from('course_lookup_cache').upsert({ key: cacheKey, data, fetched_at: new Date().toISOString() });
    return { data, status: 200 };
  }

  const failure = (status: number) =>
    json(
      {
        error:
          status === 429
            ? "The course lookup has hit today's limit. Enter the pars by hand or try again tomorrow."
            : status === 404
              ? "That course wasn't found."
              : "The course lookup isn't responding. Enter the pars by hand for now.",
      },
      status === 404 ? 404 : 502,
    );

  if (body.action === 'search') {
    const q = (body.query ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (q.length < 3 || q.length > 80) return json({ error: 'Type at least 3 letters of the course name.' }, 400);
    const r = await cached(`search:${q}`, SEARCH_TTL_DAYS, `/search?search_query=${encodeURIComponent(q)}`);
    if (!r.data) return failure(r.status);
    return json({ courses: normalizeSearch(r.data) });
  }

  if (body.action === 'course') {
    const id = String(body.id ?? '');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return json({ error: 'Bad course id.' }, 400);
    const r = await cached(`course:${id}`, COURSE_TTL_DAYS, `/courses/${encodeURIComponent(id)}`);
    if (!r.data) return failure(r.status);
    const course = normalizeCourse(r.data);
    if (!course) return json({ error: "That course's scorecard couldn't be read. Enter the pars by hand." }, 502);
    return json({ course });
  }

  return json({ error: 'Unknown action.' }, 400);
});
