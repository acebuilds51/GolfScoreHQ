// Reminders for unpaid Course plan invoices.
//
//   POST {} (header x-cron-secret) → { sent: [{ course, kind }] }
//
// Called by the database's daily timer at 13:00 UTC (9 AM Eastern). Emails the
// course's manager two weeks before an open invoice is due, then a final
// reminder a week before that explains what switches off. Support gets a copy.
// Deploy with --no-verify-jwt.
// Secrets: STRIPE_SECRET_KEY, RESEND_API_KEY, RECAP_FROM_EMAIL, SUPPORT_EMAIL (default support@golfscorehq.app).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { senderFrom } from '../_shared/sender.ts';
import { GRACE_DAYS, LIVE_STATUSES, stripeApi } from '../_shared/stripe.ts';
import { reminderEmail, reminderFor } from './reminder.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const env = (k: string) => Deno.env.get(k) ?? '';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: secret } = await admin.from('cron_secret').select('token').maybeSingle();
  if (!secret || secret.token !== req.headers.get('x-cron-secret')) return json({ error: 'Not allowed.' }, 401);

  const stripeKey = env('STRIPE_SECRET_KEY');
  const resendKey = env('RESEND_API_KEY');
  if (!stripeKey || !resendKey) return json({ error: "Payments or email aren't set up yet." }, 503);
  const support = env('SUPPORT_EMAIL') || 'support@golfscorehq.app';

  const { data: subs, error } = await admin.from('billing_subscriptions').select('stripe_subscription_id, club_id, owner_id')
    .eq('plan', 'club').not('club_id', 'is', null).in('status', LIVE_STATUSES);
  if (error) return json({ error: error.message }, 500);

  const sent: { course: string; kind: string }[] = [];
  const failed: string[] = [];
  for (const s of subs ?? []) {
    try {
      const sub = await stripeApi(stripeKey, 'GET', `subscriptions/${s.stripe_subscription_id}?expand[]=latest_invoice`);
      const inv = sub.latest_invoice;
      if (sub.collection_method !== 'send_invoice' || inv?.status !== 'open' || !inv.due_date || !inv.amount_due) continue;

      const { data: done } = await admin.from('course_invoice_reminders').select('kind').eq('invoice_id', inv.id);
      const kind = reminderFor(inv.due_date, Date.now(), (done ?? []).map((d: { kind: string }) => d.kind));
      if (!kind) continue;

      const [{ data: club }, { data: leagues }, { data: owner }] = await Promise.all([
        admin.from('clubs').select('name').eq('id', s.club_id).maybeSingle(),
        admin.from('leagues').select('name').eq('club_id', s.club_id).order('name'),
        admin.auth.admin.getUserById(s.owner_id),
      ]);
      const to = owner.user?.email;
      if (!club || !to) continue;

      // Claim it first, so a second run the same day can't send it twice.
      const { error: claim } = await admin.from('course_invoice_reminders').insert({ invoice_id: inv.id, kind, club_id: s.club_id });
      if (claim) continue;

      const email = reminderEmail({
        kind, courseName: club.name, leagues: (leagues ?? []).map((l: { name: string }) => l.name),
        amountCents: inv.amount_due, dueSec: inv.due_date, graceDays: GRACE_DAYS, payUrl: inv.hosted_invoice_url ?? null, supportEmail: support,
      });
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: senderFrom(env('RECAP_FROM_EMAIL')), to: [to], bcc: [support], reply_to: support, subject: email.subject, text: email.text }),
      });
      if (!res.ok) {
        // Let tomorrow's run try again.
        await admin.from('course_invoice_reminders').delete().eq('invoice_id', inv.id).eq('kind', kind);
        failed.push(club.name);
        continue;
      }
      sent.push({ course: club.name, kind });
    } catch (e) {
      console.error('course-reminders', s.stripe_subscription_id, e);
      failed.push(s.stripe_subscription_id);
    }
  }
  return json({ sent, failed }, failed.length ? 207 : 200);
});
