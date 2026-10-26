import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { accessUntil, formEncode, GRACE_DAYS, readSubscription, verifyStripeSignature } from '../../../supabase/functions/_shared/stripe';

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
    const base = { id: 's', periodEnd: end, cancelAtPeriodEnd: false, metadata: {}, customer: null };
    expect(accessUntil({ ...base, status: 'active' }, now).getTime()).toBe(end * 1000 + GRACE_DAYS * 86_400_000);
    expect(accessUntil({ ...base, status: 'past_due' }, now).getTime()).toBe(end * 1000 + GRACE_DAYS * 86_400_000);
    expect(accessUntil({ ...base, status: 'canceled' }, now).getTime()).toBe(now);
    expect(accessUntil({ ...base, status: 'incomplete' }, now).getTime()).toBe(now);
  });
});
