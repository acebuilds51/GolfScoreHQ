import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { accessUntil, checkoutFields, formEncode, GRACE_DAYS, readSubscription, STRIPE_API_VERSION, stripeHeaders, verifyStripeSignature } from '../../../supabase/functions/_shared/stripe';

describe('Stripe helpers', () => {
  it('encodes nested checkout fields the way Stripe expects', () => {
    const body = formEncode({
      mode: 'subscription',
      line_items: [{ price: 'price_pro', quantity: 1 }],
      subscription_data: { metadata: { league_id: 'L1', plan: 'pro' } },
      allow_promotion_codes: true,
      skip: undefined,
    });
    expect(decodeURIComponent(body)).toBe(
      'mode=subscription&line_items[0][price]=price_pro&line_items[0][quantity]=1&subscription_data[metadata][league_id]=L1&subscription_data[metadata][plan]=pro&allow_promotion_codes=true',
    );
  });

  it('only trusts webhooks signed with our secret, and recently', async () => {
    const secret = 'whsec_test';
    const body = '{"type":"customer.subscription.updated"}';
    const t = 1_800_000_000;
    const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    expect(await verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, 300, t + 10)).toBe(true);
    expect(await verifyStripeSignature(body + ' ', `t=${t},v1=${sig}`, secret, 300, t + 10)).toBe(false); // body changed
    expect(await verifyStripeSignature(body, `t=${t},v1=${sig}`, 'whsec_other', 300, t + 10)).toBe(false); // wrong secret
    expect(await verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, 300, t + 3600)).toBe(false); // replayed later
    expect(await verifyStripeSignature(body, null, secret)).toBe(false);
  });

  it('reads the paid-through date from old and new Stripe API shapes', () => {
    expect(readSubscription({ id: 's', status: 'active', current_period_end: 100, metadata: { league_id: 'L' }, customer: 'cus_1' })).toMatchObject({ periodEnd: 100, customer: 'cus_1', metadata: { league_id: 'L' } });
    expect(readSubscription({ id: 's', status: 'active', items: { data: [{ current_period_end: 200 }] }, customer: { id: 'cus_2' } })).toMatchObject({ periodEnd: 200, customer: 'cus_2' });
  });

  it('keeps features on through the paid year plus grace, and off once canceled', () => {
    const now = Date.UTC(2027, 0, 1);
    const end = Date.UTC(2027, 10, 1) / 1000;
    const base = { id: 's', periodStart: null, periodEnd: end, cancelAtPeriodEnd: false, metadata: {}, customer: null };
    expect(accessUntil({ ...base, status: 'active' }, now).getTime()).toBe(end * 1000 + GRACE_DAYS * 86_400_000);
    expect(accessUntil({ ...base, status: 'canceled' }, now).getTime()).toBe(now);
    expect(accessUntil({ ...base, status: 'incomplete' }, now).getTime()).toBe(now);
    expect(accessUntil({ ...base, status: 'unpaid' }, now).getTime()).toBe(now);
  });

  it('gives a failed renewal only the grace days, not the new unpaid year', () => {
    const renewedAt = Date.UTC(2027, 10, 1) / 1000; // Stripe has already moved the period on
    const s = { id: 's', status: 'past_due', periodStart: renewedAt, periodEnd: renewedAt + 365 * 86_400, cancelAtPeriodEnd: false, metadata: {}, customer: null };
    const graceEnd = renewedAt * 1000 + GRACE_DAYS * 86_400_000;
    expect(accessUntil(s, renewedAt * 1000 + 3_600_000).getTime()).toBe(graceEnd);
    const later = graceEnd + 86_400_000;
    expect(accessUntil(s, later).getTime()).toBe(later); // still failing after grace: off
  });

  it('gives an unpaid invoice grace from its due date, not the year start', () => {
    const sentAt = 1_798_804_800; // Jan 1 2027, 12:00 UTC
    const sub = readSubscription({ id: 's', status: 'past_due', collection_method: 'send_invoice', days_until_due: 30, current_period_start: sentAt, current_period_end: sentAt + 365 * 86_400 });
    expect(sub.daysToPay).toBe(30);
    const graceEnd = (sentAt + 30 * 86_400) * 1000 + GRACE_DAYS * 86_400_000;
    expect(new Date(graceEnd).toISOString().slice(0, 10)).toBe('2027-02-03');
    expect(accessUntil(sub, (sentAt + 30 * 86_400) * 1000 + 3_600_000).getTime()).toBe(graceEnd);
    expect(readSubscription({ id: 's', status: 'past_due', days_until_due: 30 }).daysToPay).toBeNull(); // charged, not invoiced
  });

  it('reads the period start from old and new API shapes', () => {
    expect(readSubscription({ id: 's', status: 'past_due', current_period_start: 50, current_period_end: 100 }).periodStart).toBe(50);
    expect(readSubscription({ id: 's', status: 'past_due', items: { data: [{ current_period_start: 150, current_period_end: 200 }] } }).periodStart).toBe(150);
  });

  it('pins the API version and sends idempotency keys', () => {
    const h = stripeHeaders('sk_test_x', { form: true, idempotencyKey: 'customer-u1' });
    expect(h['Stripe-Version']).toBe(STRIPE_API_VERSION);
    expect(h['Idempotency-Key']).toBe('customer-u1');
    expect(h['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(stripeHeaders('sk_test_x')).not.toHaveProperty('Idempotency-Key');
  });

  it('builds checkout with sales tax only when switched on', () => {
    const o = { customer: 'cus_1', price: 'price_pro', metadata: { plan: 'pro', league_id: 'L1', owner_id: 'u1' }, userId: 'u1', successUrl: 'https://x/done', cancelUrl: 'https://x/no' };
    const off = checkoutFields({ ...o, automaticTax: false });
    expect(off).toMatchObject({ mode: 'subscription', customer: 'cus_1', allow_promotion_codes: true, billing_address_collection: 'auto', subscription_data: { metadata: o.metadata } });
    expect(off).not.toHaveProperty('automatic_tax');
    const on = checkoutFields({ ...o, automaticTax: true });
    expect(on).toMatchObject({ automatic_tax: { enabled: true }, customer_update: { address: 'auto', name: 'auto' }, billing_address_collection: 'required' });
  });
});
