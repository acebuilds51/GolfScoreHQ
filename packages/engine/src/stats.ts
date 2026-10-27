import { individualLines, rankIndividual } from './individual';
import { scoreMatch } from './match';
import { isIndividual, type BestBallMatchRules, type FormatRules } from './rules';
import type { Cents, Layout, LedgerEntry, MatchRoundInput, PlayerId } from './types';

/** One group's round in a given week, with the holes it was played on. */
export interface PlayedRound {
  week: number;
  layout: Layout;
  round: MatchRoundInput;
}

export interface PlayerSeasonStats {
  playerId: PlayerId;
  /** Rounds with every hole recorded; only these count toward averages. */
  rounds: number;
  /** Strokes over par per complete round, oldest first. */
  toPar: { week: number; score: number; toPar: number }[];
  averageToPar: number | null;
  last4AverageToPar: number | null;
  best: { week: number; score: number; toPar: number } | null;
  birdies: number;
  eagles: number;
  aces: number;
  matchWins: number;
  matchLosses: number;
  matchHalves: number;
  skins: number;
  ctps: number;
  money: Cents;
  /** Individual formats: weeks won outright or tied for 1st, and top-3 finishes. */
  weekWins: number;
  top3: number;
  /** Stableford: points over complete rounds. */
  points: number;
  pointsRounds: number;
  averagePoints: number | null;
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);

function blank(playerId: PlayerId): PlayerSeasonStats {
  return {
    playerId, rounds: 0, toPar: [], averageToPar: null, last4AverageToPar: null, best: null,
    birdies: 0, eagles: 0, aces: 0, matchWins: 0, matchLosses: 0, matchHalves: 0, skins: 0, ctps: 0, money: 0,
    weekWins: 0, top3: 0, points: 0, pointsRounds: 0, averagePoints: null,
  };
}

/**
 * Season stats per player. Scoring is compared to par so front-nine and
 * back-nine rounds (or 9 vs 18 holes) can share one average.
 */
export function seasonStats(played: PlayedRound[], ledger: LedgerEntry[], rules: FormatRules): Record<PlayerId, PlayerSeasonStats> {
  const stats: Record<PlayerId, PlayerSeasonStats> = {};
  const get = (id: PlayerId) => (stats[id] ??= blank(id));

  // Individual formats: each week's finishing places (and Stableford points) across the whole field.
  if (isIndividual(rules)) {
    const weeks = new Map<number, PlayedRound[]>();
    for (const p of played) weeks.set(p.week, [...(weeks.get(p.week) ?? []), p]);
    for (const group of weeks.values()) {
      const layout = group[0]!.layout;
      const placed = rankIndividual(individualLines(group.map((g) => g.round), layout.holes, rules), rules);
      for (const l of placed) {
        const s = get(l.playerId);
        if (l.place === 1) s.weekWins++;
        if (l.place !== null && l.place <= 3) s.top3++;
        if (l.complete && l.points !== null) { s.points += l.points; s.pointsRounds++; }
      }
    }
  }

  // Scramble scores are team scores: they never count toward a golfer's own scoring.
  const ownBall = rules.format === 'scramble' ? [] : played;
  for (const { week, layout, round } of [...ownBall].sort((a, b) => a.week - b.week)) {
    const par = layout.holes.reduce((s, h) => s + h.par, 0);
    for (const p of round.players) {
      const s = get(p.id);
      const scores = round.scores[p.id] ?? [];
      layout.holes.forEach((h, i) => {
        const v = scores[i];
        if (v == null) return;
        if (v === 1) s.aces++;
        if (v - h.par <= -2) s.eagles++;
        else if (v - h.par === -1) s.birdies++;
      });
      if (scores.length === layout.holes.length && scores.every((v) => v != null)) {
        const score = scores.reduce<number>((t, v) => t + (v ?? 0), 0);
        const entry = { week, score, toPar: score - par };
        s.toPar.push(entry);
        s.rounds++;
        if (!s.best || entry.toPar < s.best.toPar) s.best = entry;
      }
    }
    if (rules.format !== 'bestBallMatch') continue;
    const m = scoreMatch(round, layout.holes.length, rules, layout.holes);
    const sides = { A: round.players.filter((p) => p.side === 'A'), B: round.players.filter((p) => p.side === 'B') };
    if (sides.A.length && sides.B.length) {
      for (const side of ['A', 'B'] as const) {
        for (const p of sides[side]) {
          const s = get(p.id);
          if (m.winner === null) s.matchHalves++;
          else if (m.winner === side) s.matchWins++;
          else s.matchLosses++;
        }
      }
    }
  }

  for (const e of ledger) {
    const s = get(e.playerId);
    s.money += e.amount;
    if (e.kind === 'skin') s.skins++;
    if (e.kind === 'ctp') s.ctps++;
  }

  for (const s of Object.values(stats)) {
    s.averageToPar = avg(s.toPar.map((r) => r.toPar));
    s.last4AverageToPar = avg(s.toPar.slice(-4).map((r) => r.toPar));
    s.averagePoints = s.pointsRounds ? Math.round((s.points / s.pointsRounds) * 10) / 10 : null;
  }
  return stats;
}

export interface HeadToHead {
  playerA: PlayerId;
  playerB: PlayerId;
  aWins: number;
  bWins: number;
  halves: number;
}

/** Match record between every pair of players who were on opposite sides. Keyed "a|b" (ids sorted). */
export function headToHead(played: PlayedRound[], rules: BestBallMatchRules): Record<string, HeadToHead> {
  const out: Record<string, HeadToHead> = {};
  for (const { layout, round } of played) {
    const m = scoreMatch(round, layout.holes.length, rules);
    const a = round.players.filter((p) => p.side === 'A').map((p) => p.id);
    const b = round.players.filter((p) => p.side === 'B').map((p) => p.id);
    for (const x of a) {
      for (const y of b) {
        const [p1, p2] = [x, y].sort() as [PlayerId, PlayerId];
        const rec = (out[`${p1}|${p2}`] ??= { playerA: p1, playerB: p2, aWins: 0, bWins: 0, halves: 0 });
        if (m.winner === null) rec.halves++;
        else {
          const winnerId = m.winner === 'A' ? x : y;
          if (winnerId === p1) rec.aWins++;
          else rec.bWins++;
        }
      }
    }
  }
  return out;
}

export type AwardKey =
  | 'lowAverage' | 'bestRound' | 'mostSkins' | 'ctpKing' | 'birdieMachine'
  | 'eagleClub' | 'aceClub' | 'matchPlayChamp' | 'weeklyWins' | 'pointsLeader' | 'moneyLeader' | 'hotStreak' | 'mostImproved';

export interface Award {
  key: AwardKey;
  title: string;
  /** Everyone tied for the award. */
  winners: PlayerId[];
  /** The number behind it, e.g. average to par, skins won, cents. */
  value: number;
}

export interface AwardOptions {
  /** Complete rounds needed to qualify for average-based awards. Default 4. */
  minRounds?: number;
  /** Handicap Index at the start and end of the season, for Most Improved. */
  handicaps?: Record<PlayerId, { start: number | null; end: number | null }>;
}

function top(key: AwardKey, title: string, entries: [PlayerId, number][], better: 'high' | 'low'): Award | null {
  const real = entries.filter(([, v]) => Number.isFinite(v));
  if (!real.length) return null;
  const bestVal = better === 'high' ? Math.max(...real.map(([, v]) => v)) : Math.min(...real.map(([, v]) => v));
  if (better === 'high' && bestVal <= 0) return null;
  return { key, title, winners: real.filter(([, v]) => v === bestVal).map(([id]) => id).sort(), value: bestVal };
}

/** End-of-season awards. Ties share an award. Awards nobody earned are left out. */
export function seasonAwards(stats: Record<PlayerId, PlayerSeasonStats>, opts: AwardOptions = {}): Award[] {
  const minRounds = opts.minRounds ?? 4;
  const all = Object.values(stats);
  const qualified = all.filter((s) => s.rounds >= minRounds);
  const awards: (Award | null)[] = [
    top('lowAverage', 'Lowest scoring average', qualified.map((s) => [s.playerId, s.averageToPar ?? NaN]), 'low'),
    top('bestRound', 'Best round of the year', all.filter((s) => s.best).map((s) => [s.playerId, s.best!.toPar]), 'low'),
    top('mostSkins', 'Skins leader', all.map((s) => [s.playerId, s.skins]), 'high'),
    top('ctpKing', 'CTP king', all.map((s) => [s.playerId, s.ctps]), 'high'),
    top('birdieMachine', 'Birdie machine', all.map((s) => [s.playerId, s.birdies]), 'high'),
    top('matchPlayChamp', 'Match play champ', all.map((s) => [s.playerId, s.matchWins]), 'high'),
    top('weeklyWins', 'Most weekly wins', all.map((s) => [s.playerId, s.weekWins]), 'high'),
    top('pointsLeader', 'Stableford points leader', all.map((s) => [s.playerId, s.points]), 'high'),
    top('moneyLeader', 'Money leader', all.map((s) => [s.playerId, s.money]), 'high'),
    top(
      'hotStreak', 'Hottest finish',
      qualified.filter((s) => s.averageToPar !== null && s.last4AverageToPar !== null)
        .map((s) => [s.playerId, Math.round((s.averageToPar! - s.last4AverageToPar!) * 10) / 10]),
      'high',
    ),
  ];

  const eagles = all.filter((s) => s.eagles > 0).map((s) => s.playerId).sort();
  if (eagles.length) awards.push({ key: 'eagleClub', title: 'Eagle club', winners: eagles, value: eagles.length });
  const aces = all.filter((s) => s.aces > 0).map((s) => s.playerId).sort();
  if (aces.length) awards.push({ key: 'aceClub', title: 'Hole-in-one club', winners: aces, value: aces.length });

  if (opts.handicaps) {
    const drops = Object.entries(opts.handicaps)
      .filter(([, h]) => h.start !== null && h.end !== null)
      .map(([id, h]) => [id, Math.round((h.start! - h.end!) * 10) / 10] as [PlayerId, number]);
    awards.push(top('mostImproved', 'Most improved', drops, 'high'));
  }
  return awards.filter((a): a is Award => a !== null);
}
