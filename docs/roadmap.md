# GolfScoreHQ roadmap

## Plans

| Plan | Price | Who |
|---|---|---|
| Free | $0 | Any league, unlimited golfers: scoring, live leaderboard, standings, roster, invites, handicaps, basic formats, current season |
| Pro | $149 per league per year | Everything below plus side games and money, all formats, tee sheet, RSVPs and reminders, past seasons, co-commissioners, export, branding, recap emails, awards, Clubhouse TV, import |
| Course | $990 per year (Founding Course price, first 5 Florida courses) | Golf courses: Pro for every league at the course, TV sponsor screen, setup done for them, invoiced (not Stripe Checkout). Stored as the `club` plan; the $299 self-serve Club checkout is gone from the app |
| Pilot | $0 in 2027 | The 10 pilot leagues get Pro; 2028 at Pro price (~10% thank-you discount) |
| Comp | $0 | Complimentary Pro (OCBC, test leagues); never billed |

Plans and features live in the `plans` table, so prices and feature lists can change without a code release. Billing is Stripe Checkout (charged up front each year, refunds also cancel the subscription).

## Built

- **Scoring:** season setup, weeks, groups, hole-by-hole entry that works offline, live leaderboard, settlement (commissioner only, by hand, so scores can be checked first) and rainouts.
- **Formats:** 2-vs-2 best ball match (presses), stroke play, Stableford, scramble seasons and scramble weeks.
- **Handicaps:** a golfer's Handicap Index typed in (from GHIN) or calculated from league rounds; net matches and skins.
- **Money:** skins, closest to the pin, prize money, ledger. **Paying out (Pro):** season dues with a who-paid checklist, a weekly Pay out list with Venmo/PayPal filled in (golfer, amount, note) and paid ticks golfers can see, golfers' own Venmo/PayPal/Zelle, and a league choice of whether match money is settled between golfers (shown, never collected) or goes through the commissioner. The app never moves money.
- **Standings, awards and player stats:** with a shareable awards picture and hardest/easiest holes, a Hot sort (last 4 rounds), and every week's skins and CTP winners for commissioners. Past seasons (Pro) from a season picker. Commissioners choose whether golfers see season money.
- **Seasons:** start the next season with the same format, league night and tee times; add the whole season's weeks at once, skipping off nights.
- **Weekly recap email (Pro):** each golfer's own balance, pay links, optional AI write-up the commissioner reviews.
- **Tee sheet (Pro):** tee times set once for the season (a week can differ), optional weekly captains, golfers join groups, need-a-partner / need-a-match lists, one-tap group texts to the right golfers (split under carrier limits).
- **RSVP and sub finder (Pro):** plus "Are you playing?" reminder emails at 9 AM league time with one-tap answers (no sign-in) and send-now.
- **Roster:** paste or add golfers, contact details (phones and emails shared with golfers only if the commissioner turns each on), merge duplicates, subs section, text one golfer or many from the phone's Messages, invite by text with personal join links.
- **Phone notifications:** free web push for reminders and "results are in" (iPhone: from the home-screen app).
- **Clubhouse TV (Pro):** rotating panels on any screen from a private link. Course plan adds a sponsor screen.
- **Course plan:** a course's leagues under one club record (no league cap since migration 20261127), with this week across all of them on the Leagues page. Set up by staff, not self-serve.
- **Branding (Pro):** league logo and colors in the app, TV and emails.
- **Getting started:** "We set up your league" uploads with a staff queue; import past rounds from Excel (.xlsx), CSV, pasted cells or the old OCBC app's export.
- **Sales tax:** Stripe Tax is wired in, off until the `STRIPE_AUTOMATIC_TAX` secret is `on`.
- **Look and speed:** league-colored header with fairway stripes, splash screen, five-tab bottom bar; screens open instantly on what they showed last time, pages download before they're tapped.
- **App health (staff):** the app reports its own problems, golfers can report one, capacity against plan limits, a daily health email.
- **Upgrade prompts:** free leagues see "wouldn't it be great if…" teasers and each golfer's share of Pro; golfers can say they'd chip in.
- **Phone notifications** for the tee sheet and subs (moved to a group, put in a group, a partner, a sub needed or found), and "results are in" the moment a week is settled, in every league. OCBC's 2026 season is imported.
- **Help:** a Help page with an AI "Ask a question" (answers from the user's guide, saved for staff), commissioner and golfer guides, eight walk-through lessons (golfers and commissioners × four formats), and a "?" Ask button on every screen.
- **Ideas and questions box:** golfers and commissioners send ideas or questions; staff reply on /staff and the sender gets a notification.
- **Sign-in emails** from signin@golfscorehq.app through Resend, with our own code email.
- **Pro badges:** every locked feature's badge opens what it does, the price, each golfer's share and "I'd chip in".
- **Download your league (Pro):** scores hole by hole, money and standings for any season, as spreadsheets.
- **Splash:** a short video of a drive coming at the screen.
- **Selling the Course plan (staff):** set up a course for its manager on /staff, add its leagues, and send the yearly Stripe invoice (Founding offer: the first invoice goes out Jan 1, 2027 and is due Jan 31; Pro switches off 3 days after an unpaid due date; pay by card or bank, or mark paid by check). Renews every year with a new invoice. Reminder emails to the manager two weeks and one week before an unpaid invoice is due; the final one lists what switches off and when.
- **Course summary:** one printable page per course with every league's golfers, golfers on the app, league nights played, rounds brought to the course and average turnout.
- **Post to GHIN:** golfers add their GHIN number; after a finished round the week page shows their scorecard and an Open GHIN button (no USGA license needed, so the golfer still enters the score). See [ghin.md](ghin.md).
- **No signal on the course:** the app opens with no signal (its files are kept on the phone), every group's round is saved on the phone from the week page so it opens and scores offline, screens keep what they last loaded instead of an error, golfers stay signed in, waiting scores send from any screen or the next time the app opens, and a card submitted with no signal goes in by itself once every score has. A "No signal" bar says what's happening.
- **Lesson results (staff):** every lesson try is saved as it goes, signed in or not. /staff shows per lesson how many tried and finished, the step where most stop, the quiz question most missed, how it felt, and what people would change. Finished lessons show done on every phone for signed-in people.

## Next

- **Before pilots play (spring 2027):** upgrade Resend from the free plan (100 emails a day); a practice league night on real phones (including a round in airplane mode); test the ideas box with a second person.
- An official GHIN connection only if paying customers ever cover the USGA fee (see [ghin.md](ghin.md)).
- Paid text messages only if leagues ask.
