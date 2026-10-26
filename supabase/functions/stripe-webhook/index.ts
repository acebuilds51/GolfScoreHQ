// Stripe calls this after payments, renewals, failed cards and cancellations.
// It switches Pro (per league) or Club on and off. Deploy without JWT checks
// (Stripe can't sign in); every call is verified with the webhook secret instead.
//
//   npx supabase functions deploy stripe-webhook --use-api --no-verify-jwt
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { accessUntil, readSubscription, stripeApi, verifyStripeSignature } from '../_shared/stripe.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const reply = (status: number, msg: string) => new Response(msg, { status });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, 'Use POST.');
  const raw = await req.text();
  if (!(await verifyStripeSignature(raw, req.headers.get('stripe-signature'), env('STRIPE_WEBHOOK_SECRET')))) {
    return reply(400, 'Bad signature.');
  }
  const event = JSON.parse(raw);
  const obj = event.data?.object ?? {};
  const subId: string | null =
    event.type === 'checkout.session.completed' ? (typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id ?? null)
    : event.type?.startsWith('customer.subscription.') ? obj.id
    : event.type === 'invoice.paid' || event.type === 'invoice.payment_failed' ? (obj.subscription ?? obj.parent?.subscription_details?.subscription ?? null)
    : null;
  if (!subId) return reply(200, 'Ignored.');

  try {
    // Ask Stripe for the subscription as it is now, so events arriving out of order can't set an old state.
    const s = readSubscription(await stripeApi(env('STRIPE_SECRET_KEY'), 'GET', `subscriptions/${subId}`));
    const { plan, league_id: leagueId, club_id: clubId, owner_id: ownerId } = s.metadata;
    if ((plan !== 'pro' && plan !== 'club') || !ownerId || (plan === 'pro' ? !leagueId : !clubId)) return reply(200, 'Not a GolfScoreHQ plan.');

    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    const until = accessUntil(s).toISOString();
    const { error: upErr } = await admin.from('billing_subscriptions').upsert({
      stripe_subscription_id: s.id,
      owner_id: ownerId,
      league_id: plan === 'pro' ? leagueId : null,
      club_id: plan === 'club' ? clubId : null,
      plan,
      status: s.status,
      current_period_end: s.periodEnd ? new Date(s.periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: s.cancelAtPeriodEnd,
      updated_at: new Date().toISOString(),
    });
    if (upErr) throw upErr;
    if (s.customer) await admin.from('billing_customers').upsert({ user_id: ownerId, stripe_customer_id: s.customer }, { onConflict: 'user_id', ignoreDuplicates: true });

    if (plan === 'pro') {
      // Never touch free Pilot/Complimentary leagues or Club-covered ones.
      const { error } = await admin.from('leagues').update({ plan: 'pro', plan_expires_at: until }).eq('id', leagueId).in('plan', ['free', 'pro']);
      if (error) throw error;
    } else {
      const { error } = await admin.from('clubs').update({ plan_expires_at: until }).eq('id', clubId);
      if (error) throw error;
    }
    return reply(200, 'OK');
  } catch (e) {
    console.error('stripe-webhook', event.type, subId, e);
    return reply(500, 'Try again.'); // Stripe retries
  }
});
