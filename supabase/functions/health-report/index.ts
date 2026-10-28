// The daily health check.
//
//   POST {} (header x-cron-secret) → emails support when something needs a look
//                                    (and a summary every Monday); { sent, subject }
//
// Called by the database's daily timer at 12:00 UTC. Deploy with --no-verify-jwt.
// Secrets: RESEND_API_KEY, RECAP_FROM_EMAIL, SUPPORT_EMAIL (default support@golfscorehq.app), APP_URL.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { senderFrom } from '../_shared/sender.ts';
import { buildHealthReport, type HealthSnapshot } from './report.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const env = (k: string) => Deno.env.get(k) ?? '';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: secret } = await admin.from('cron_secret').select('token').maybeSingle();
  if (!secret || secret.token !== req.headers.get('x-cron-secret')) return json({ error: 'Not allowed.' }, 401);

  const { data, error } = await admin.rpc('health_snapshot', { p_days: 7 });
  if (error) return json({ error: error.message }, 500);
  const report = buildHealthReport(data as HealthSnapshot, new Date(), env('APP_URL') || 'https://golfscorehq.app');
  if (!report) return json({ sent: false, reason: 'nothing to report' });

  const key = env('RESEND_API_KEY');
  if (!key) return json({ error: "Email isn't set up yet (RESEND_API_KEY)." }, 503);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: senderFrom(env('RECAP_FROM_EMAIL')), to: [env('SUPPORT_EMAIL') || 'support@golfscorehq.app'], subject: report.subject, text: report.text }),
  });
  if (!res.ok) return json({ error: `The email service refused it (${res.status}).` }, 502);
  return json({ sent: true, subject: report.subject });
});
