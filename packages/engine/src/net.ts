import type { HandicapRules } from './rules';
import type { Hole, MatchRoundInput, PlayerId } from './types';

// Net scoring: turning Course Handicaps into strokes on particular holes.

/** Strokes a golfer gets after the league's allowance (e.g. 90% of 12 = 11). */
export function playingHandicap(courseHandicap: number, allowancePct: number): number {
  return Math.round((courseHandicap * allowancePct) / 100);
}

/**
 * Where `strokes` fall on these holes, by stroke index (1 = hardest). Strokes
 * go on the hardest holes first and wrap round for more than one per hole.
 * A plus handicap (negative strokes) gives strokes back on the easiest holes.
 * Holes without a stroke index are treated as easiest, in hole order.
 */
export function strokesByHole(strokes: number, holes: Hole[]): number[] {
  const n = holes.length;
  if (!n || !strokes) return holes.map(() => 0);
  const order = holes
    .map((h, i) => ({ i, si: h.strokeIndex ?? Number.MAX_SAFE_INTEGER, num: h.number }))
    .sort((a, b) => a.si - b.si || a.num - b.num)
    .map((x) => x.i);
  const rank = new Array<number>(n);
  order.forEach((holeIdx, r) => (rank[holeIdx] = r));
  const m = Math.abs(strokes);
  const base = Math.floor(m / n);
  const extra = m % n;
  return holes.map((_, i) => {
    const r = strokes > 0 ? rank[i]! : n - 1 - rank[i]!;
    const s = base + (r < extra ? 1 : 0);
    return strokes > 0 || s === 0 ? s : -s;
  });
}

const courseHcp = (round: MatchRoundInput, id: PlayerId) => round.courseHandicaps?.[id] ?? 0;

/** Each golfer's strokes for the match under these rules (0 for everyone when the match is gross). */
export function matchStrokes(round: MatchRoundInput, rules: HandicapRules | undefined): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {};
  if (!rules?.enabled || rules.match === 'gross') {
    for (const p of round.players) out[p.id] = 0;
    return out;
  }
  for (const p of round.players) out[p.id] = playingHandicap(courseHcp(round, p.id), rules.allowance);
  if (rules.match === 'offLow') {
    const inMatch = round.players.filter((p) => p.side).map((p) => out[p.id]!);
    const low = inMatch.length ? Math.min(...inMatch) : 0;
    for (const p of round.players) if (p.side) out[p.id] = out[p.id]! - low;
  }
  return out;
}

/** Each golfer's own full strokes (after allowance): used for net skins and the net leaderboard. */
export function ownStrokes(round: MatchRoundInput, rules: HandicapRules | undefined): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {};
  for (const p of round.players) out[p.id] = rules?.enabled ? playingHandicap(courseHcp(round, p.id), rules.allowance) : 0;
  return out;
}

/** The same round with every recorded score reduced by the strokes on that hole. */
export function netRound(round: MatchRoundInput, holes: Hole[], strokes: Record<PlayerId, number>): MatchRoundInput {
  const scores: MatchRoundInput['scores'] = {};
  for (const [id, row] of Object.entries(round.scores)) {
    const per = strokesByHole(strokes[id] ?? 0, holes);
    scores[id] = row.map((s, i) => (s == null ? null : s - (per[i] ?? 0)));
  }
  return { ...round, scores };
}
