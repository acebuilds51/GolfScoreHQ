// "Ask a question" on the Help page.
//
//   POST { messages: [{ role, content }, …], leagueSlug? } → { answer, id }
//
// Signed-in people only, 20 questions an hour each. Claude answers from the
// Help page's questions and answers and the user's guide; every question is saved for staff to see
// what people get stuck on. Secrets: ANTHROPIC_API_KEY, HELP_AI_MODEL (optional).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { answerFromResponse, cleanConversation, HELP_BETA, helpRequest } from './ask.ts';
import { guideText } from './guide.ts';
import { manualText } from './manual.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const env = (k: string) => Deno.env.get(k) ?? '';
const PER_HOUR = 20;
// The Help page's answers, then the user's guide.
const MANUAL = `${manualText()}\n\n${guideText()}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) return json({ error: 'Sign in to ask a question.' }, 401);

  let body: { messages?: unknown; leagueSlug?: string | null };
  try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const messages = cleanConversation(body.messages);
  if (!messages) return json({ error: 'Type your question first.' }, 400);
  const question = messages[messages.length - 1]!.content;

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from('help_questions').select('id', { count: 'exact', head: true }).eq('user_id', auth.user.id).gte('created_at', since);
  if ((count ?? 0) >= PER_HOUR) return json({ error: "That's a lot of questions for one hour. Try again a bit later, or tap Send it to us." }, 429);

  const leagueId = body.leagueSlug
    ? (await admin.from('leagues').select('id').eq('slug', String(body.leagueSlug).slice(0, 60)).maybeSingle()).data?.id ?? null
    : null;
  const save = async (answer: string | null) =>
    (await admin.from('help_questions').insert({ user_id: auth.user!.id, league_id: leagueId, question, answer, turn: messages.length }).select('id').single()).data?.id ?? null;

  const key = env('ANTHROPIC_API_KEY');
  if (!key) {
    await save(null);
    return json({ error: "The question helper isn't set up yet. Tap Send it to us and we'll answer by email." }, 503);
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': HELP_BETA, 'content-type': 'application/json' },
    body: JSON.stringify(helpRequest({ manual: MANUAL, messages, model: env('HELP_AI_MODEL') })),
  });
  if (!res.ok) {
    console.error('anthropic', res.status, (await res.text().catch(() => '')).slice(0, 500));
    await save(null);
    return json({ error: `The helper isn't answering right now (${res.status}). Look through the questions above, or tap Send it to us.` }, 502);
  }
  const reply = await res.json();
  const answer = answerFromResponse(reply);
  const id = await save(answer);
  if (!answer) {
    console.error('anthropic empty', reply?.stop_reason, JSON.stringify(reply?.usage));
    return json({ error: "The helper couldn't answer that one. Tap Send it to us and a person will.", id }, 502);
  }
  return json({ answer, id });
});
