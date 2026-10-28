# GolfScoreHQ roadmap

## Plans

| Plan | Price | Who |
|---|---|---|
| Free | $0 | Any league, unlimited golfers: scoring, live leaderboard, standings, roster, invites, handicaps, basic formats, current season |
| Pro | $149 per league per year | Everything below plus side games and money, all formats, tee sheet, RSVPs and reminders, past seasons, co-commissioners, export, branding, recap emails, awards, Clubhouse TV, import |
| Club | $299 per year, up to 5 leagues | Pro for every league, plus a multi-league dashboard and priority support |
| Pilot | $0 in 2027 | The 10 pilot leagues get Pro; 2028 at Pro price (~10% thank-you discount) |
| Comp | $0 | Complimentary Pro (OCBC, test leagues); never billed |

Plans and features live in the `plans` table, so prices and feature lists can change without a code release. Billing is Stripe Checkout (charged up front, refunds also cancel the subscription).

## Built

- **Scoring:** season setup, weeks, groups, hole-by-hole entry that works offline, live leaderboard, settlement (commissioner only, by hand, so scores can be checked first) and rainouts.
- **Formats:** 2-vs-2 best ball match (presses), stroke play, Stableford, scramble seasons and scramble weeks.
- **Handicaps:** GHIN index or calculated from league rounds; net matches and skins.
- **Money:** skins, closest to the pin, prize money, ledger, Venmo/PayPal/Zelle links.
- **Standings, awards and player stats:** with a shareable awards picture and hardest/easiest holes, a Hot sort (last 4 rounds), and every week's skins and CTP winners for commissioners. Past seasons (Pro) from a season picker. Commissioners choose whether golfers see season money.
- **Seasons:** start the next season with the same format, league night and tee times; add the whole season's weeks at once, skipping off nights.
- **Weekly recap email (Pro):** each golfer's own balance, pay links, optional AI write-up the commissioner reviews.
- **Tee sheet (Pro):** tee times set once for the season (a week can differ), optional weekly captains, golfers join groups, need-a-partner / need-a-match lists, one-tap group texts to the right golfers (split under carrier limits).
- **RSVP and sub finder (Pro):** plus "Are you playing?" reminder emails at 9 AM league time with one-tap answers (no sign-in) and send-now.
- **Roster:** paste or add golfers, contact details (phones and emails shared with golfers only if the commissioner turns each on), merge duplicates, subs section, text one golfer or many from the phone's Messages, invite by text with personal join links.
- **Phone notifications:** free web push for reminders and "results are in" (iPhone: from the home-screen app).
- **Clubhouse TV (Pro):** rotating panels on any screen from a private link. Club plan adds a sponsor screen.
- **Club plan:** up to 5 leagues, with this week across all of them on the Leagues page.
- **Branding (Pro):** league logo and colors in the app, TV and emails.
- **Getting started:** "We set up your league" uploads with a staff queue; import past rounds from Excel (.xlsx), CSV, pasted cells or the old OCBC app's export.
- **Sales tax:** Stripe Tax is wired in, off until the `STRIPE_AUTOMATIC_TAX` secret is `on`.

## Next

- More phone notifications: added to a group, sub requests, a partner or match found.
- Paid text messages only if leagues ask.
- Bring the old OCBC app's 2026 season in for the 2027 pilot, then retire it.
