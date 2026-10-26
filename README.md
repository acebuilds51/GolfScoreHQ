# GolfScoreHQ

Multi-tenant golf league scoring platform. Commissioners configure their league's
format from building blocks (teams, hole scoring, match/stroke/points, side games,
schedule) instead of each league getting custom code.

## Layout

| Path | What it is |
|---|---|
| `packages/engine` | Pure TypeScript rules engine: matches, presses, skins, CTP, scramble, WHS handicaps. No I/O. |
| `supabase/migrations` | Postgres schema: leagues, members, roster, courses, seasons, rounds, hole-by-hole scores, ledger, payments, plan limits, and row-level security. |
| `packages/db` | Tests that run the migrations in an embedded Postgres (PGlite) and check tenant isolation, roles and plan limits. |
| `legacy/ocbc` | The original OCBC Golf League PWA (v2.24) and its Apps Script backend, kept as a reference. OCBC itself runs from its own repo. |

| `apps/web` | React + Vite web app: sign-in, leagues, roster (bulk paste, invite links), courses, league code and join requests, member roles. Runs on Supabase, or in demo mode (browser storage) when Supabase isn't configured. |
| `docs/` | [Roadmap](docs/roadmap.md) and [Supabase setup](docs/supabase-setup.md). |

Run the web app with `npm run dev` (http://localhost:5173). Without `apps/web/.env.local` it starts in demo mode.

## Database conventions

- Every league-owned row has `league_id`; children reference parents with composite `(league_id, id)` keys, so rows can't cross leagues.
- RLS: members read their league; commissioners manage it; any member can score until a week is settled, then only commissioners.
- Contact details are in `player_contacts`, visible only to commissioners and the golfer.
- `ledger_entries` is written only by settlement (service role). `payments` records money actually handed over; the app never moves money.
- Plans are by feature, never by league size (unlimited golfers on every plan). The `plans` table lists price and features:
  Free ($0), Pro ($149 per league per season), Club ($299 per season, up to 5 leagues), plus `pilot` (Pro features, no charge) and `comp` (free forever).
- Features are enforced in the database with `league_has_feature(league_id, feature)`: triggers block Pro-only rules, roles and branding;
  RLS blocks Pro-only writes (presses, CTP, payments) and hides past seasons from Free leagues. A lapsed plan falls back to Free; nothing is deleted.
- Free allows one free league per owner. Plan, expiry and club fields change only through the service role (billing webhook).

## Engine conventions

- Money is integer **cents**; splits never lose a cent (`splitEvenly`).
- Every wager settles zero-sum, including short-handed (2 vs 1) matches.
- Rules are plain data (`FormatRules`). Each season stores a frozen copy, so old weeks recalculate under the rules they were played with.
- Templates live in `src/templates.ts` (`OCBC_BEST_BALL`, `OCBC_SCRAMBLE`).

## Commands

```bash
npm install
npm test
npm run typecheck
```

### Legacy parity check

`test/legacy-parity.test.ts` replays real OCBC rounds and reports where the engine
and the legacy app disagree. League data is private and is never committed: export
the `RawRounds` sheet to a local JSON array and set `OCBC_ROUNDS_JSON` to its path.
The test is skipped when the variable is not set.
