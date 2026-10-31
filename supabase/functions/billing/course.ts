// The Course plan is sold to golf courses and paid by invoice: a yearly Stripe
// subscription that emails an invoice (card, bank transfer, or marked paid by
// check) instead of charging a card. Its metadata matches a Checkout club
// subscription, so stripe-webhook keeps it in step after renewals and payments.
//
// A free period (the Founding Course offer) is a Stripe trial: the first invoice
// goes out the day it ends, so the course pays by the end of the free period
// (Jan 1 + 30 days to pay = due Jan 31).
//
// The course gets its leagues on Pro as soon as the invoice is sent. If it isn't
// paid by the due date, Stripe marks the subscription past due and the plan
// switches off after the grace days from the due date (accessUntil).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { accessUntil, LIVE_STATUSES, readSubscription, stripeApi } from '../_shared/stripe.ts';

export interface CourseRequest {
  action?: string;
  clubId?: string;
  /** Yearly price in cents (the Founding Course price is 99000). */
  priceCents?: number;
  /** Days the course has to pay each invoice. */
  daysUntilDue?: number;
  /** Have Stripe email the invoice to the course's manager. */
  email?: boolean;
  /** No charge until this day (YYYY-MM-DD): the first invoice goes out then. */
  freeUntil?: string | null;
}

export interface CourseInvoice {
  url: string | null;
  status: string;
  amountDue: number;
  dueDate: string | null;
  /** While the course is in its free period: when the first invoice goes out. */
  freeUntil: string | null;
}

const PRODUCT_NAME = 'GolfScoreHQ Course plan';

export async function courseBilling(key: string, admin: SupabaseClient, body: CourseRequest): Promise<CourseInvoice> {
  if (!body.clubId) throw new Error('Which course?');
  const { data: club } = await admin.from('clubs').select('id, name, owner_id').eq('id', body.clubId).maybeSingle();
  if (!club) throw new Error("That course wasn't found.");
  const { data: subs } = await admin.from('billing_subscriptions').select('stripe_subscription_id, status')
    .eq('club_id', club.id).order('updated_at', { ascending: false });
  const live = (subs ?? []).find((s: { status: string }) => LIVE_STATUSES.includes(s.status));

  if (body.action === 'course-invoice') {
    if (live) throw new Error('This course is already billed. Use Invoice link to see it.');
    const cents = Math.round(Number(body.priceCents));
    if (!(cents >= 10000 && cents <= 1_000_000)) throw new Error('The price is $100 to $10,000 a year.');
    const days = Math.round(Number(body.daysUntilDue ?? 30));
    if (!(days >= 1 && days <= 90)) throw new Error('Give the course 1 to 90 days to pay.');
    // Noon UTC on the day, so it's that date in every US time zone.
    const trialEnd = body.freeUntil ? Math.floor(Date.parse(`${body.freeUntil}T12:00:00Z`) / 1000) : null;
    if (trialEnd !== null && !(trialEnd > Date.now() / 1000 + 86_400 && trialEnd < Date.now() / 1000 + 400 * 86_400)) {
      throw new Error('The free period has to end between tomorrow and a year from now.');
    }

    const { data: owner } = await admin.auth.admin.getUserById(club.owner_id);
    const sub = await stripeApi(key, 'POST', 'subscriptions', {
      customer: await customerFor(key, admin, club.owner_id, owner.user?.email ?? undefined, club.name),
      items: [{ price: await yearlyPrice(key, cents) }],
      collection_method: 'send_invoice',
      days_until_due: days,
      description: `${PRODUCT_NAME} for ${club.name}`,
      metadata: { plan: 'club', club_id: club.id, owner_id: club.owner_id },
      ...(trialEnd ? { trial_end: trialEnd } : {}),
      expand: ['latest_invoice'],
    });
    await record(admin, sub, club.id, club.owner_id);
    let inv = sub.latest_invoice;
    if (inv?.status === 'draft') inv = await stripeApi(key, 'POST', `invoices/${inv.id}/finalize`, { auto_advance: true });
    if (body.email && inv?.status === 'open') inv = await stripeApi(key, 'POST', `invoices/${inv.id}/send`, {});
    return invoiceOf(inv, sub);
  }

  const subId = live?.stripe_subscription_id ?? subs?.[0]?.stripe_subscription_id;
  if (!subId) throw new Error("This course hasn't been invoiced yet.");
  const sub = await stripeApi(key, 'GET', `subscriptions/${subId}?expand[]=latest_invoice`);

  if (body.action === 'course-link') return invoiceOf(sub.latest_invoice, sub);

  if (body.action === 'course-paid') {
    const inv = sub.latest_invoice;
    if (inv?.status !== 'open') throw new Error(inv?.status === 'paid' ? 'That invoice is already paid.' : 'There is no open invoice to mark paid.');
    const paid = await stripeApi(key, 'POST', `invoices/${inv.id}/pay`, { paid_out_of_band: true });
    await record(admin, await stripeApi(key, 'GET', `subscriptions/${subId}`), club.id, club.owner_id);
    return invoiceOf(paid, sub);
  }

  throw new Error('Unknown action.');
}

function invoiceOf(inv: Record<string, any> | null | undefined, sub: Record<string, any>): CourseInvoice {
  if (!inv) throw new Error('Stripe has no invoice for this course yet. Try Invoice link in a minute.');
  const trialEnd = sub.status === 'trialing' && sub.trial_end ? sub.trial_end : null;
  // While free, the first invoice's due date is the day it goes out plus the days to pay.
  const due = trialEnd ? trialEnd + (sub.days_until_due ?? 0) * 86_400 : inv.due_date;
  return {
    freeUntil: trialEnd ? new Date(trialEnd * 1000).toISOString() : null,
    url: inv.hosted_invoice_url ?? null,
    status: inv.status,
    amountDue: inv.amount_due ?? 0,
    dueDate: due ? new Date(due * 1000).toISOString() : null,
  };
}

/** The manager's Stripe customer: the same one Checkout would use for them. */
async function customerFor(key: string, admin: SupabaseClient, userId: string, email: string | undefined, courseName: string): Promise<string> {
  const { data } = await admin.from('billing_customers').select('stripe_customer_id').eq('user_id', userId).maybeSingle();
  if (data) return data.stripe_customer_id;
  const c = await stripeApi(key, 'POST', 'customers', { email, name: courseName, metadata: { user_id: userId } }, `customer-${userId}`);
  const { error } = await admin.from('billing_customers').upsert({ user_id: userId, stripe_customer_id: c.id }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (error) throw error;
  return c.id;
}

/** One yearly Stripe price per amount (the Founding price and later ones), found by its lookup key. */
async function yearlyPrice(key: string, cents: number): Promise<string> {
  const lookup = `course_plan_${cents}`;
  const found = await stripeApi(key, 'GET', `prices?${new URLSearchParams({ 'lookup_keys[]': lookup, active: 'true' })}`);
  if (found.data?.[0]?.id) return found.data[0].id;
  const p = await stripeApi(key, 'POST', 'prices', {
    currency: 'usd', unit_amount: cents, recurring: { interval: 'year' }, lookup_key: lookup, transfer_lookup_key: true, product_data: { name: PRODUCT_NAME },
  }, `price-${lookup}`);
  return p.id;
}

/** What stripe-webhook does for a club subscription, done straight away so the course doesn't wait for the webhook. */
async function record(admin: SupabaseClient, raw: Record<string, any>, clubId: string, ownerId: string) {
  const s = readSubscription(raw);
  const { error } = await admin.from('billing_subscriptions').upsert({
    stripe_subscription_id: s.id, owner_id: ownerId, league_id: null, club_id: clubId, plan: 'club', status: s.status,
    current_period_end: s.periodEnd ? new Date(s.periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: s.cancelAtPeriodEnd, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  const { error: e2 } = await admin.from('clubs').update({ plan_expires_at: accessUntil(s).toISOString() }).eq('id', clubId);
  if (e2) throw e2;
}
