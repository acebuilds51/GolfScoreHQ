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

Planned: `apps/web` (React + Vite PWA) and the hosted Supabase project.

## Database conventions

- Every league-owned row has `league_id`; children reference parents with composite `(league_id, id)` keys, so rows can't cross leagues.
- RLS: members read their league; commissioners manage it; any member can score until a week is settled, then only commissioners.
- Contact details are in `player_contacts`, visible only to commissioners and the golfer.
- `ledger_entries` is written only by settlement (service role). `payments` records money actually handed over; the app never moves money.
- Plan limits are triggers (free: 1 league per owner, 20 regular players). Plan fields change only through the service role.

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
