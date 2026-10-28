// Phone notifications.
//
//   POST { action: 'key' }  → { key }   the public key a phone subscribes with (null: not set up)
//   POST { action: 'test' } → { sent }  a test notification to the signed-in person's own devices
//   POST { action: 'outbox' } (header x-cron-secret) → sends what the database queued (tee sheet, subs)
//
// Deploy with --no-verify-jwt (the database calls it without a user); each
// action checks what it needs itself.
//
// Devices are saved by the app straight into push_subscriptions (each person
// manages their own); the other server functions send through _shared/push.ts.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { pushReady, pushToUsers } from '../_shared/push.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const env = (k: string) => Deno.env.get(k) ?? '';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  let body: { action?: string };
  try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400); }

  if (body.action === 'key') return json({ key: pushReady() ? env('VAPID_PUBLIC_KEY') : null });

  // The database's outbox (tee sheet and sub finder news), called by the database itself.
  if (body.action === 'outbox') {
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    const { data: secret } = await admin.from('cron_secret').select('token').maybeSingle();
    if (!secret || secret.token !== req.headers.get('x-cron-secret')) return json({ error: 'Not allowed.' }, 401);
    const { data: waiting, error } = await admin.rpc('take_push_outbox');
    if (error) return json({ error: error.message }, 500);
    let sent = 0;
    for (const m of (waiting ?? []) as { user_ids: string[]; title: string; body: string; url: string; tag: string | null }[]) {
      sent += await pushToUsers(admin, m.user_ids, { title: m.title, body: m.body, url: m.url, tag: m.tag ?? undefined }).catch((e) => { console.error('outbox push', e); return 0; });
    }
    return json({ messages: (waiting ?? []).length, sent });
  }

  if (body.action === 'test') {
    const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: auth } = await userClient.auth.getUser();
    if (!auth.user) return json({ error: 'Sign in first.' }, 401);
    if (!pushReady()) return json({ error: "Phone notifications aren't set up yet." }, 503);
    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    const sent = await pushToUsers(admin, [auth.user.id], { title: 'GolfScoreHQ', body: 'Notifications are on for this phone. ⛳', url: '/leagues', tag: 'test' });
    return json({ sent });
  }
  return json({ error: 'Unknown action.' }, 400);
});
