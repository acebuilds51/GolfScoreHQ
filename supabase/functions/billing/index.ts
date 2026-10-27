// Billing server function: starts Stripe Checkout and opens Stripe's billing
// page. Signed-in users only. Stripe hosts both pages, so card details never
// reach GolfScoreHQ.
//
//   POST { action: 'checkout', leagueId }  → { url }   Pro for one league (commissioners)
//   POST { action: 'checkout', clubId }    → { url }   Club (the club's owner)
//   POST { action: 'portal', returnPath? } → { url }   update card, invoices, cancel
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, STRIPE_PRICE_CLUB, APP_URL.
// Optional: STRIPE_AUTOMATIC_TAX=on once Stripe Tax is set up in the dashboard.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { checkoutFields, stripeApi } from '../_shared/stripe.ts';

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

  const stripeKey = env('STRIPE_SECRET_KEY');
  if (!stripeKey) return json({ error: "Payments aren't set up yet." }, 503);
  const app = env('APP_URL') || 'https://golfscorehq.app';

  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: auth } = await userClient.auth.getUser();
  const user = auth.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);

  let body: { action?: string; leagueId?: string; clubId?: string; returnPath?: string };
  try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

  // One Stripe customer per person who pays.
  async function customerId(create: boolean): Promise<string | null> {
    const { data } = await admin.from('billing_customers').select('stripe_customer_id').eq('user_id', user!.id).maybeSingle();
    if (data) return data.stripe_customer_id;
    if (!create) return null;
    // Keyed on the person, so a double click makes one Stripe customer, not two.
    const c = await stripeApi(stripeKey, 'POST', 'customers', { email: user!.email, metadata: { user_id: user!.id } }, `customer-${user!.id}`);
    const { error } = await admin.from('billing_customers').upsert({ user_id: user!.id, stripe_customer_id: c.id }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (error) throw error;
    return c.id;
  }

  try {
    if (body.action === 'portal') {
      const cid = await customerId(false);
      if (!cid) return json({ error: "There's no billing on file for you yet." }, 404);
      const path = (body.returnPath ?? '/leagues').startsWith('/') ? body.returnPath ?? '/leagues' : '/leagues';
      const s = await stripeApi(stripeKey, 'POST', 'billing_portal/sessions', { customer: cid, return_url: `${app}${path}` });
      return json({ url: s.url });
    }

    if (body.action !== 'checkout') return json({ error: 'Unknown action.' }, 400);

    let price: string, metadata: Record<string, string>, back: string;
    if (body.leagueId) {
      const { data: isCommish } = await userClient.rpc('is_commissioner', { lid: body.leagueId });
      if (!isCommish) return json({ error: 'Only commissioners can upgrade the league.' }, 403);
      const { data: lg } = await admin.from('leagues').select('id, slug, plan, plan_expires_at').eq('id', body.leagueId).single();
      if (!lg) return json({ error: "That league wasn't found." }, 404);
      if (lg.plan === 'pilot' || lg.plan === 'comp') return json({ error: 'This league already has GolfScoreHQ Pro free.' }, 400);
      if (lg.plan === 'club') return json({ error: 'This league is covered by a Club plan.' }, 400);
      const { data: live } = await admin.from('billing_subscriptions').select('stripe_subscription_id').eq('league_id', lg.id).in('status', ['active', 'trialing', 'past_due']).limit(1);
      if (live?.length) return json({ error: 'This league already pays for Pro. Use Manage billing to change it.' }, 400);
      price = env('STRIPE_PRICE_PRO');
      metadata = { plan: 'pro', league_id: lg.id, owner_id: user.id };
      back = `/l/${lg.slug}/settings`;
    } else if (body.clubId) {
      const { data: club } = await admin.from('clubs').select('id, owner_id, plan_expires_at').eq('id', body.clubId).single();
      if (!club || club.owner_id !== user.id) return json({ error: "That club isn't yours." }, 403);
      if (club.plan_expires_at && new Date(club.plan_expires_at) > new Date()) return json({ error: 'This club is already paid up. Use Manage billing to change it.' }, 400);
      price = env('STRIPE_PRICE_CLUB');
      metadata = { plan: 'club', club_id: club.id, owner_id: user.id };
      back = '/leagues';
    } else {
      return json({ error: 'Which league or club?' }, 400);
    }
    if (!price) return json({ error: "Payments aren't set up yet." }, 503);

    const session = await stripeApi(stripeKey, 'POST', 'checkout/sessions', checkoutFields({
      customer: (await customerId(true))!,
      price,
      metadata,
      userId: user.id,
      successUrl: `${app}${back}?billing=done`,
      cancelUrl: `${app}${back}?billing=cancelled`,
      automaticTax: env('STRIPE_AUTOMATIC_TAX') === 'on',
    }));
    return json({ url: session.url });
  } catch (e) {
    console.error('billing', e);
    return json({ error: `Payments are having trouble right now. ${(e as Error).message}` }, 502);
  }
});
