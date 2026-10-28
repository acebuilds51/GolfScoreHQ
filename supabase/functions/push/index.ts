// Phone notifications.
//
//   POST { action: 'key' }  → { key }   the public key a phone subscribes with (null: not set up)
//   POST { action: 'test' } → { sent }  a test notification to the signed-in person's own devices
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
