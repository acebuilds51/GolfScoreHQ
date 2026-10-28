# Setting up Supabase

The web app runs in demo mode until it's pointed at a Supabase project. These steps create the free project and load the database.

## 1. Create the project (about 5 minutes)

1. Go to [supabase.com](https://supabase.com) and sign up (signing in with GitHub is easiest).
2. **New project**
   - Name: `golfscorehq`
   - Database password: generate one and save it in your password manager. You won't need it day to day.
   - Region: **East US (Ohio)** (closest to Michigan)
   - Plan: **Free**

## 2. Load the database

Pick one:

**A. Copy and paste (no tools needed)**
In the Supabase dashboard open **SQL Editor → New query**. Paste each file from `supabase/migrations/` **in filename order** and press **Run** after each one:

1. `20261026000000_init.sql`
2. `20261027000000_ctp_marker_chain.sql`
3. `20261028000000_pricing_tiers.sql`
4. `20261029000000_pro_features.sql`
5. `20261030000000_join_request_identity.sql`
6. `20261031000000_course_lookup.sql`
7. `20261101000000_scoring.sql`
8. `20261102000000_settlement.sql`
9. `20261103000000_realtime.sql`
10. `20261104000000_tv_feed.sql`
11. `20261105000000_branding.sql` (league logo and colors; also creates the `league-logos` storage bucket)
12. `20261106000000_league_banner.sql` (course photo banner)
13. `20261107000000_ctp_nobody_fix.sql` (lets "nobody got inside the marker" save)
14. `20261108000000_billing.sql` (Stripe billing for Pro and Club)
15. `20261109000000_handicaps.sql` (GHIN/handicap index on golfers, course handicap fixed per round)
16. `20261110000000_individual_formats.sql` (stroke play and Stableford: prize money by place)
17. `20261111000000_scramble.sql` (Clubhouse TV knows when a week is a scramble)
18. `20261112000000_setup_service.sql` ("We set up your league": uploads, staff queue; creates the private `setup-uploads` bucket)
19. `20261113000000_merge_players.sql` (merge duplicate golfers on the roster)
20. `20261114000000_phone_book.sql` (golfers can text each other when the commissioner shares phone numbers)
21. `20261115000000_tee_sheet.sql` (tee sheet: tee times, captains, groups, partners and matches)

**B. Command line**

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

```bash
npx supabase db push
```

## 3. Sign-in settings

**Authentication → URL Configuration**

- Site URL: `http://localhost:5173` (change to the real domain at launch)
- Redirect URLs: add `http://localhost:5173/**`

Email sign-in links are on by default. Supabase's built-in email sender allows only a few emails per hour, which is fine for testing. Before the pilots, connect a real email provider (Resend) under **Authentication → Emails → SMTP**.

## 4. Connect the app

**Project Settings → API**: copy the **Project URL** and the **anon public** key into `apps/web/.env.local`:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

The anon key is meant to be public: the database's access rules protect the data. **Never** put the `service_role` key in the app or share it.

Restart the dev server and the demo banner disappears.

## 5. Course lookup (optional, recommended)

Lets commissioners search for their course and have the scorecard (pars, stroke index, rating, slope) fill in. Without it, they enter pars by hand.

1. Sign up at [golfcourseapi.com](https://golfcourseapi.com) (free: 35 lookups a day; each course is only looked up once and then saved).
2. In Supabase: **Edge Functions → Secrets** (or **Project Settings → Edge Functions**), add a secret named `GOLFCOURSEAPI_KEY` with your key. Keep the key out of chat, email and the code.
3. Deploy the function from the `GolfScoreHQ` folder:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

```bash
npx supabase functions deploy course-lookup --use-api
```

`--use-api` builds the function on Supabase's side, so Docker isn't needed.

To try the lookup without a key, run `npm run dev:demo`: it uses made-up sample courses ("maple", "pine").

## 6. Weekly recap email (Pro)

After a week is settled, the commissioner taps **Email the recap** on the week page. Each golfer gets the week's results plus what they personally won or owe, with Venmo / PayPal / Zelle links (from **Settings → How golfers pay you**) when they owe. Golfers can turn it off on the league's Overview page.

1. Sign up at [resend.com](https://resend.com) (free: 3,000 emails a month, 100 a day) and create an API key.
2. To send from your own address, add your domain in Resend (**Domains**) and add the DNS records it shows you. Until then, Resend's test sender only delivers to your own Resend account's email, which is fine for trying it out.
3. In Supabase **Edge Functions → Secrets**, add:
   - `RESEND_API_KEY`: your Resend key. Keep it out of chat, email and the code.
   - `RECAP_FROM_EMAIL`: who the email is from: `GolfScoreHQ <recaps@golfscorehq.app>` (must be on the domain verified in Resend).
   - `APP_URL`: where the app lives, `https://golfscorehq.app`, so the email's link points to the league.
4. Deploy the function from the `GolfScoreHQ` folder (after `npx supabase login` and `link` from step 5):

```bash
npx supabase functions deploy send-recap --use-api
```

The function uses a bundled copy of the scoring engine (`supabase/functions/_shared/engine.js`). After changing anything in `packages/engine`, run `npm run build:functions` and commit the result; a test fails if the copy is out of date.

In demo mode the recap screens work but no email is sent.

### AI write-up (optional)

**Write it up with AI** on the week page drafts a short, fun opening for the email from that week's results. The commissioner reads it, edits anything, and it's sent exactly as shown. The results underneath always come from the scoring engine, not the AI.

1. Create an API key at [console.anthropic.com](https://console.anthropic.com) (**API Keys**) and add some credit. A write-up costs a few cents at most: one per week per league, not one per golfer.
2. In Supabase **Edge Functions → Secrets**, add `ANTHROPIC_API_KEY` with the key. Keep it out of chat, email and the code.
3. Optional: `RECAP_AI_MODEL` to use a different Claude model (default `claude-opus-5-5`).
4. Redeploy: `npx supabase functions deploy send-recap --use-api`

Only golfers' names and the week's results are sent to the AI, never emails or phone numbers.

## 7. "We set up your league" (Pro)

Commissioners upload their spreadsheets and notes from **We set up your league** (Overview checklist or the More menu). Each request emails support with 7-day download links; staff work it from `/staff`.

1. Make yourself staff. In the SQL Editor (use the email you sign in to GolfScoreHQ with):

```sql
insert into staff_users (user_id) select id from auth.users where email = 'you@example.com';
```

2. Optional secret `SUPPORT_EMAIL` (default `support@golfscorehq.app`): where new requests are emailed. It uses the same `RESEND_API_KEY`, `RECAP_FROM_EMAIL` and `APP_URL` as the recap.
3. Deploy the function:

```bash
npx supabase functions deploy setup-notify --use-api
```

On `/staff`: download the files, **Join the league to set it up** (only when the commissioner ticked the consent box), do the setup with the normal screens, then set the status and write a message. Saving emails the commissioner; **All set up** takes you back out of the league.
