# Setting up payments (Stripe)

GolfScoreHQ sells **Pro** ($149 per league per year) and **Club** ($299 per year, up to 5 of the buyer's leagues). Stripe hosts checkout and the billing page, so card details never reach GolfScoreHQ. Pilot and Complimentary leagues are never charged.

Do everything in **test mode** first (Stripe's toggle, top right), try a purchase with Stripe's test card `4242 4242 4242 4242` (any future date, any CVC), then repeat steps 2–5 in live mode.

## 1. Database

Paste migration `20261108000000_billing.sql` in the Supabase SQL Editor.

## 2. Products and prices (Stripe dashboard → Product catalog)

- **GolfScoreHQ Pro**: recurring price, **$149.00 per year**. Copy the price ID (`price_…`).
- **GolfScoreHQ Club**: recurring price, **$299.00 per year**. Copy its price ID.

## 3. Customer portal (Stripe → Settings → Billing → Customer portal)

Turn on: update payment method, view invoices, cancel subscriptions (cancel **at end of billing period**). Save. This is the page behind **Manage billing**.

## 4. Webhook (Stripe → Developers → Webhooks → Add endpoint)

- URL: `https://foxthtwxgfnoqxrcbxfc.supabase.co/functions/v1/stripe-webhook`
- Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
- After saving, reveal the **Signing secret** (`whsec_…`).

## 5. Supabase secrets (Edge Functions → Secrets)

| Secret | Value |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys → Secret key (`sk_test_…`, later `sk_live_…`) |
| `STRIPE_PRICE_PRO` | Pro price ID from step 2 |
| `STRIPE_PRICE_CLUB` | Club price ID from step 2 |
| `STRIPE_WEBHOOK_SECRET` | Signing secret from step 4 |

Keep these out of chat, email and the code. `APP_URL` (already set for recap emails) is where checkout sends people back.

## 6. Deploy the two functions (from the GolfScoreHQ folder)

```bash
npx supabase functions deploy billing --use-api
```

```bash
npx supabase functions deploy stripe-webhook --use-api --no-verify-jwt
```

`--no-verify-jwt` is required for the webhook: Stripe can't sign in, so the function checks Stripe's signature on every call instead.

## How it behaves

- **Upgrade:** Settings → Plan → Upgrade to Pro opens Stripe Checkout. After paying, Pro turns on within a few seconds.
- **Renewals:** yearly, automatic. A failed card keeps Pro on for 3 days of grace while Stripe retries.
- **Cancel:** Manage billing → cancel. Pro stays on until the paid year ends, then the league is Free. Nothing is deleted.
- **Discount codes:** create coupons and promotion codes in Stripe; checkout has a box for them (e.g. the 2028 pilot thank-you).
- **Club:** Your leagues → Club plan → name it and pay, then add up to 5 leagues you own. A league that already pays for its own Pro must cancel it first.
- **Pilots:** set by hand in the SQL Editor (`update leagues set plan = 'pilot' where slug = '…'`); they never see checkout.
