// Small Stripe helpers shared by the billing server functions. No imports and
// no Stripe library: plain HTTPS calls, so they run in Deno and in tests.

/** Stripe's API takes form fields; nested objects become name[key][sub]=value. */
export function formEncode(obj: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => parts.push(typeof item === 'object' && item !== null ? formEncode(item as Record<string, unknown>, `${key}[${i}]`) : `${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`));
    else if (typeof v === 'object') parts.push(formEncode(v as Record<string, unknown>, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.filter(Boolean).join('&');
}

/**
 * Stripe API version every call uses, so a change to the account's default in
 * the Stripe dashboard can't quietly change the shapes we read. Upgrade on purpose.
 */
export const STRIPE_API_VERSION = '2025-03-31.basil';

export function stripeHeaders(secretKey: string, opts: { form?: boolean; idempotencyKey?: string } = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${secretKey}`,
    'Stripe-Version': STRIPE_API_VERSION,
    ...(opts.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    // Same key within 24h → Stripe returns the first result instead of doing it twice.
    ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
  };
}

export async function stripeApi<T = Record<string, any>>(secretKey: string, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: stripeHeaders(secretKey, { form: !!body, idempotencyKey }),
    body: body ? formEncode(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? `Stripe error ${res.status}`);
  return json as T;
}

/**
 * The Checkout Session for a yearly plan. With automatic tax on (needs Stripe
 * Tax set up in the dashboard), Stripe works out sales tax from the address
 * the buyer enters and saves that address on their customer record.
 */
export function checkoutFields(o: { customer: string; price: string; metadata: Record<string, string>; userId: string; successUrl: string; cancelUrl: string; automaticTax: boolean }): Record<string, unknown> {
  return {
    mode: 'subscription',
    customer: o.customer,
    line_items: [{ price: o.price, quantity: 1 }],
    subscription_data: { metadata: o.metadata },
    metadata: o.metadata,
    client_reference_id: o.userId,
    allow_promotion_codes: true,
    billing_address_collection: o.automaticTax ? 'required' : 'auto',
    ...(o.automaticTax ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto', name: 'auto' }, tax_id_collection: { enabled: true } } : {}),
    success_url: o.successUrl,
    cancel_url: o.cancelUrl,
  };
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Check a webhook really came from Stripe: the Stripe-Signature header carries a
 * timestamp and an HMAC-SHA256 of "timestamp.body" made with the endpoint's secret.
 * Rejects anything older than `toleranceSec` to stop replays.
 */
export async function verifyStripeSignature(rawBody: string, header: string | null, secret: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!header || !secret) return false;
  const fields = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = Number(fields.find(([k]) => k === 't')?.[1]);
  const sigs = fields.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(nowSec - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`)));
  // Compare without bailing out early, so timing doesn't leak how much matched.
  return sigs.some((s) => s.length === expected.length && [...s].reduce((diff, ch, i) => diff | (ch.charCodeAt(0) ^ expected.charCodeAt(i)), 0) === 0);
}

export interface SubscriptionState {
  id: string;
  status: string;
  /** Start and end of the current billing year (seconds since 1970), or null if Stripe didn't say. */
  periodStart: number | null;
  periodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  metadata: Record<string, string>;
  customer: string | null;
  /** Invoiced (not charged) subscriptions: days the customer has to pay each invoice. */
  daysToPay?: number | null;
}

/** Read what matters from a Stripe subscription (newer API versions keep the period on the items). */
export function readSubscription(sub: Record<string, any>): SubscriptionState {
  const periodStart = sub.current_period_start ?? sub.items?.data?.[0]?.current_period_start ?? null;
  const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  return {
    id: sub.id,
    status: sub.status,
    periodStart: typeof periodStart === 'number' ? periodStart : null,
    periodEnd: typeof periodEnd === 'number' ? periodEnd : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end || !!sub.cancel_at,
    metadata: sub.metadata ?? {},
    customer: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
    daysToPay: sub.collection_method === 'send_invoice' && typeof sub.days_until_due === 'number' ? sub.days_until_due : null,
  };
}

/** A few days' grace after the paid year so a late card retry doesn't switch features off mid-week. */
export const GRACE_DAYS = 3;

/** Statuses where the subscription still counts (paid, trial, or a renewal card being retried). */
export const LIVE_STATUSES = ['active', 'trialing', 'past_due'];

/**
 * Until when the plan's features stay on. Paid: the end of the paid year plus
 * grace. Renewal card failing (past_due): Stripe has already moved the period
 * on to the new, unpaid year, so only grace from that year's start (for an
 * invoice, from its due date). Canceled for good or never paid: now (features
 * off). A successful retry makes it active again and the next webhook restores
 * the full year.
 */
export function accessUntil(s: SubscriptionState, nowMs = Date.now()): Date {
  if (!LIVE_STATUSES.includes(s.status) || !s.periodEnd) return new Date(nowMs);
  if (s.status === 'past_due') {
    const from = s.periodStart != null ? s.periodStart + (s.daysToPay ?? 0) * 86_400 : Math.floor(nowMs / 1000);
    return new Date(Math.max(nowMs, from * 1000 + GRACE_DAYS * 86_400_000));
  }
  return new Date(s.periodEnd * 1000 + GRACE_DAYS * 86_400_000);
}
