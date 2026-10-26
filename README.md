# GolfScoreHQ

Multi-tenant golf league scoring platform. Commissioners configure their league's
format from building blocks (teams, hole scoring, match/stroke/points, side games,
schedule) instead of each league getting custom code.

## Layout

| Path | What it is |
|---|---|
| `packages/engine` | Pure TypeScript rules engine: matches, presses, skins, CTP, scramble, WHS handicaps. No I/O. |
| `legacy/ocbc` | The original OCBC Golf League PWA (v2.24) and its Apps Script backend, kept as a reference. OCBC itself runs from its own repo. |

Planned: `apps/web` (React + Vite PWA) and a Supabase project (Postgres with row-level security per league).

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
