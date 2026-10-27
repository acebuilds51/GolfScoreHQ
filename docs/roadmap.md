# GolfScoreHQ roadmap

## Plans

| Plan | Price | Who |
|---|---|---|
| Free | $0 | Any league, unlimited golfers: scoring, live leaderboard, standings, roster, invites, handicaps, basic formats, current season |
| Pro | $149 per league per season | Everything below plus side games and money, dues/payout tracking, all formats, lineup, all seasons, co-commissioners, export, branding |
| Club | $299 per season, up to 5 leagues | Pro for every league, plus a multi-league dashboard, priority support, TV sponsor slot |
| Pilot | $0 in 2027 | The 10 pilot leagues get Pro; 2028 at Pro price (~10% thank-you discount) |

Plans and features live in the `plans` table, so prices and feature lists can change without a code release.

## Pro features

Status key: **Built** = data model and logic done and tested. **Next** = needs the web app or a server job.

### 1. Weekly recap email
- **Built:** `weeklyRecap()` and `recapText()` in the engine (matches, skins, CTP, low round, birdies/eagles, this week's and season balances, optional hidden dollar amounts). `recap_sends` log so a week is never emailed twice. Golfers can opt out in `notification_prefs`.
- **Next:** server job that runs when a week settles, builds the recap and emails each golfer with their own balance and Venmo/PayPal buttons. Email provider: Resend (free up to 3,000 emails/month).

### 2. RSVP and sub finder
- **Built:** `event_rsvps` (in / out / maybe, golfers answer for themselves, commissioners for anyone). `sub_requests` and `sub_offers` with `respond_to_sub_offer()`, which gives the spot to the first sub who accepts and tells later ones "too late".
- **Next:** RSVP screen and reminder ("Are you playing Thursday?") two days before; sub request screen for commissioners; notifications by email and web push (free). Text messages are optional later (cost per message).

### 3. "We set up your league"
- **Built:** `setup_requests` (commissioner uploads a spreadsheet; staff update status through the service role).
- **Built (app):** upload screen and staff queue (`/staff`, with consent-based temporary commissioner access); **Import past rounds** (Pro): paste or CSV, one row per golfer per round, columns guessed and adjustable, or the old OCBC app's export (teams, presses, CTPs); imports into the current or a new past season, adds missing golfers, never touches weeks that already have scores, optionally settles each week.
- **Next:** run the real OCBC 2026 export through it; .xlsx files directly (today: copy-paste or CSV).

### 4. Season awards and stats
- **Built:** `seasonStats()`, `headToHead()` and `seasonAwards()` in the engine: lowest average, best round, skins leader, CTP king, birdie machine, eagle and hole-in-one clubs, match play champ, money leader, hottest finish, most improved (handicap). Ties share an award.
- **Built (app):** player stats page (tiles for everyone; Pro adds a week-by-week chart, score mix, par-3/4/5 scoring, best and worst holes, head-to-head), awards page with a shareable awards picture, the course's hardest and easiest holes, most improved from course handicaps, weekly wins and Stableford points awards.
- **Next:** past seasons (history), an end-of-season "final" moment (commissioner closes the season).

### 5. Clubhouse TV mode
- **Built:** `tv_displays` (commissioner-created links, stored as a hash, revocable, settings for panels, seconds per panel and hiding dollar amounts). Mockup approved.
- **Next:** the `/tv/<token>` page (rotating panels: live, matches, skins, CTP, highlights, standings, QR code) and the read-only server function behind it. Club: multi-league screen and sponsor slot.

## Build order

1. Web app shell: sign-in, create league, roster with bulk paste, invites, course setup.
2. Scoring screens on the engine (including the CTP "inside of" question), live leaderboard.
3. Settlement job, ledger, payments, Venmo/PayPal/Zelle buttons.
4. Weekly recap (1) and RSVP/sub finder (2) — ready for the 2027 pilots.
5. Clubhouse TV (5), awards and stats (4), setup service (3).
6. Billing (Stripe) before the 2028 season.
