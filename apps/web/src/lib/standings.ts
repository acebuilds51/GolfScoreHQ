import { seasonAwards, seasonStats, type Award, type LedgerEntry, type PlayedRound } from '@golfscorehq/engine';
import { toEngineRound, weekRules } from './scoring';
import type { Layout, LeagueEvent, LedgerRow, Player, RoundData, Season } from './types';

export interface WeekScore {
  week: number;
  score: number;
  toPar: number;
}

export interface StandingRow {
  playerId: string;
  name: string;
  isSub: boolean;
  rounds: number;
  /** Average gross score per round (rounds on the same number of holes). */
  average: number | null;
  averageToPar: number | null;
  last4AverageToPar: number | null;
  /** Last 4 rounds at least half a stroke better than the season average. */
  hot: boolean;
  best: WeekScore | null;
  wins: number;
  losses: number;
  halves: number;
  /** Stroke play and Stableford: weeks won (ties count) and top-3 finishes. */
  weekWins: number;
  top3: number;
  /** Stableford points over full rounds, and per round. */
  points: number;
  averagePoints: number | null;
  skins: number;
  ctps: number;
  money: number;
  weeks: WeekScore[];
}

export type SortKey = 'money' | 'average' | 'wins' | 'weekWins' | 'points' | 'skins' | 'ctps';

export interface Standings {
  rows: StandingRow[];
  weeksCounted: number;
  awards: Award[];
  /** Settled own-ball rounds (scramble weeks left out), for player and course stats. */
  played: PlayedRound[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Standings from the season's settled weeks. Scores, match records and money
 * all come from the engine, the same way each week was settled.
 */
export function buildStandings(input: {
  season: Season;
  events: LeagueEvent[];
  rounds: RoundData[];
  ledger: (LedgerRow & { eventId: string })[];
  layouts: Layout[];
  players: Player[];
}): Standings {
  const settled = new Map(input.events.filter((e) => e.status === 'settled').map((e) => [e.id, e]));
  const layoutById = new Map(input.layouts.map((l) => [l.id, l]));

  const played: PlayedRound[] = [];
  for (const r of input.rounds) {
    const ev = settled.get(r.eventId);
    const layout = ev?.layoutId ? layoutById.get(ev.layoutId) : undefined;
    if (!ev || !layout) continue;
    // A scramble week's scores are team scores: they don't count toward anyone's own scoring.
    if (weekRules(input.season, ev).format === 'scramble') continue;
    played.push({ week: ev.weekNumber, layout: { id: layout.id, name: layout.name, holes: layout.holes }, round: toEngineRound(r, layout) });
  }
  const ledger: LedgerEntry[] = input.ledger
    .filter((e) => settled.has(e.eventId))
    .map((e) => ({ playerId: e.playerId, amount: e.amountCents, kind: e.kind, ...(e.roundId ? { roundId: e.roundId } : {}), ...(e.holeNumber ? { holeNumber: e.holeNumber } : {}) }));

  const stats = seasonStats(played, ledger, input.season.rules);
  const byId = new Map(input.players.map((p) => [p.id, p]));

  const rows: StandingRow[] = Object.values(stats)
    .filter((s) => s.rounds > 0 || s.money !== 0 || s.skins > 0 || s.ctps > 0)
    .map((s) => {
      const p = byId.get(s.playerId);
      const avgGross = s.toPar.length ? round1(s.toPar.reduce((t, r) => t + r.score, 0) / s.toPar.length) : null;
      return {
        playerId: s.playerId,
        name: p?.displayName ?? 'Unknown golfer',
        isSub: p?.isSub ?? false,
        rounds: s.rounds,
        average: avgGross,
        averageToPar: s.averageToPar,
        last4AverageToPar: s.last4AverageToPar,
        hot: s.rounds >= 4 && s.averageToPar !== null && s.last4AverageToPar !== null && s.last4AverageToPar < s.averageToPar - 0.5,
        best: s.best,
        wins: s.matchWins,
        losses: s.matchLosses,
        halves: s.matchHalves,
        weekWins: s.weekWins,
        top3: s.top3,
        points: s.points,
        averagePoints: s.averagePoints,
        skins: s.skins,
        ctps: s.ctps,
        money: s.money,
        weeks: s.toPar,
      };
    });

  const handicaps = handicapChanges(played);
  return {
    rows,
    weeksCounted: settled.size,
    awards: seasonAwards(stats, { minRounds: Math.min(4, Math.max(1, Math.ceil(settled.size / 2))), ...(Object.keys(handicaps).length ? { handicaps } : {}) }),
    played,
  };
}

/**
 * For Most Improved: each golfer's Course Handicap in their first and latest
 * settled rounds this season (fixed when their group started). Golfers with
 * fewer than two handicapped rounds are left out.
 */
export function handicapChanges(played: PlayedRound[]): Record<string, { start: number | null; end: number | null }> {
  const seen = new Map<string, number[]>();
  for (const { round } of [...played].sort((a, b) => a.week - b.week)) {
    for (const p of round.players) {
      const ch = round.courseHandicaps?.[p.id];
      if (ch == null) continue;
      seen.set(p.id, [...(seen.get(p.id) ?? []), ch]);
    }
  }
  const out: Record<string, { start: number | null; end: number | null }> = {};
  for (const [id, chs] of seen) if (chs.length >= 2) out[id] = { start: chs[0]!, end: chs[chs.length - 1]! };
  return out;
}

export function sortStandings(rows: StandingRow[], key: SortKey): StandingRow[] {
  const byAvg = (r: StandingRow) => r.averageToPar ?? Number.POSITIVE_INFINITY;
  const cmp: Record<SortKey, (a: StandingRow, b: StandingRow) => number> = {
    money: (a, b) => b.money - a.money || byAvg(a) - byAvg(b),
    average: (a, b) => byAvg(a) - byAvg(b) || b.rounds - a.rounds,
    wins: (a, b) => b.wins - a.wins || a.losses - b.losses,
    weekWins: (a, b) => b.weekWins - a.weekWins || b.top3 - a.top3 || byAvg(a) - byAvg(b),
    points: (a, b) => b.points - a.points || (b.averagePoints ?? 0) - (a.averagePoints ?? 0),
    skins: (a, b) => b.skins - a.skins || b.money - a.money,
    ctps: (a, b) => b.ctps - a.ctps || b.money - a.money,
  };
  return [...rows].sort((a, b) => cmp[key](a, b) || a.name.localeCompare(b.name));
}

export const fmtToPar = (n: number | null) => (n === null ? '—' : n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));
