import { settleCtp, type CtpResult } from './ctp';
import { splitEvenly } from './money';
import { ownStrokes, strokesByHole } from './net';
import type { IndividualRules, StablefordPoints } from './rules';
import type { SkinsResult } from './skins';
import type { Cents, Hole, Layout, LedgerEntry, MatchRoundInput, PlayerId } from './types';
import { fieldSkins, par3s } from './week';

// Individual formats (stroke play and Stableford): every golfer plays their own
// ball against the whole field. Groups have no sides.

/** Stableford points for one hole, from the score against par (already net when playing net). */
export function stablefordPoints(toPar: number, pts: StablefordPoints): number {
  if (toPar <= -3) return pts.albatross;
  if (toPar === -2) return pts.eagle;
  if (toPar === -1) return pts.birdie;
  if (toPar === 0) return pts.par;
  if (toPar === 1) return pts.bogey;
  return pts.double;
}

export interface IndividualLine {
  playerId: PlayerId;
  roundId: string;
  teeSlot: number;
  /** Holes with a score. */
  thru: number;
  /** Every hole has a score: only complete rounds place. */
  complete: boolean;
  /** Gross strokes on the holes played. */
  gross: number;
  grossToPar: number;
  /** Handicap strokes received on the holes played (0 playing gross). */
  strokes: number;
  /** Net to par with handicaps on, otherwise gross to par (holes played). Stroke play ranks on this. */
  toPar: number;
  /** Stableford points so far; null in stroke play. */
  points: number | null;
  /** Stableford points on each hole; null where not played (and in stroke play). */
  holePoints: (number | null)[];
}

/** One golfer's round so far under these rules. */
export function individualLine(round: MatchRoundInput, playerId: PlayerId, holes: Hole[], rules: IndividualRules): IndividualLine {
  const scores = round.scores[playerId] ?? [];
  const given = rules.handicaps?.enabled ? strokesByHole(ownStrokes(round, rules.handicaps)[playerId] ?? 0, holes) : null;
  let thru = 0, gross = 0, par = 0, strokes = 0, points = 0;
  const holePoints = holes.map((h, i) => {
    const s = scores[i];
    if (s == null) return null;
    const got = given?.[i] ?? 0;
    thru++;
    gross += s;
    par += h.par;
    strokes += got;
    if (rules.format !== 'stableford') return null;
    const p = stablefordPoints(s - got - h.par, rules.points);
    points += p;
    return p;
  });
  return {
    playerId, roundId: round.id, teeSlot: round.teeSlot,
    thru, complete: holes.length > 0 && thru === holes.length,
    gross, grossToPar: gross - par, strokes, toPar: gross - par - strokes,
    points: rules.format === 'stableford' ? points : null,
    holePoints,
  };
}

export function individualLines(rounds: MatchRoundInput[], holes: Hole[], rules: IndividualRules): IndividualLine[] {
  return rounds.flatMap((r) => r.players.map((p) => individualLine(r, p.id, holes, rules)));
}

export interface PlacedLine extends IndividualLine {
  /** Finishing place (1 = winner), shared on a tie. Null for an unfinished round, which doesn't place. */
  place: number | null;
  tied: boolean;
}

/** Negative when `a` is doing better: fewer strokes to par, or more Stableford points. */
export function compareLines(rules: IndividualRules) {
  return (a: IndividualLine, b: IndividualLine) => (rules.format === 'stableford' ? (b.points ?? 0) - (a.points ?? 0) : a.toPar - b.toPar);
}

/** Finished rounds ranked best first with shared places on ties, then unfinished rounds (furthest along first). */
export function rankIndividual(lines: IndividualLine[], rules: IndividualRules): PlacedLine[] {
  const cmp = compareLines(rules);
  const done = lines.filter((l) => l.complete).sort((a, b) => cmp(a, b) || a.teeSlot - b.teeSlot);
  const rest = lines.filter((l) => !l.complete).sort((a, b) => b.thru - a.thru || cmp(a, b) || a.teeSlot - b.teeSlot);
  const placed = done.map((l) => {
    const same = done.filter((x) => cmp(x, l) === 0);
    return { ...l, place: done.indexOf(same[0]!) + 1, tied: same.length > 1 };
  });
  return [...placed, ...rest.map((l) => ({ ...l, place: null, tied: false }))];
}

/**
 * Prize money by place. Golfers tied for a place share the money for every
 * place they cover (two tied for 2nd split 2nd and 3rd).
 */
export function placePayouts(placed: PlacedLine[], payouts: Cents[]): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  const places = [...new Set(placed.map((l) => l.place).filter((p): p is number => p !== null))];
  for (const place of places) {
    const tied = placed.filter((l) => l.place === place);
    const pot = payouts.slice(place - 1, place - 1 + tied.length).reduce((s, c) => s + Math.max(0, c), 0);
    if (pot <= 0) continue;
    const shares = splitEvenly(pot, tied.length);
    tied.forEach((l, i) => out.push({ playerId: l.playerId, amount: shares[i]!, kind: 'place', roundId: l.roundId }));
  }
  return out;
}

export interface IndividualWeekResult {
  leaderboard: PlacedLine[];
  skins: SkinsResult;
  ctp: CtpResult;
  ledger: LedgerEntry[];
}

/** Settle a week of stroke play or Stableford: places, plus field-wide skins and CTP. */
export function settleIndividualWeek(rounds: MatchRoundInput[], layout: Layout, rules: IndividualRules): IndividualWeekResult {
  const leaderboard = rankIndividual(individualLines(rounds, layout.holes, rules), rules);
  const skins = fieldSkins(rounds, layout, rules.skins, rules.handicaps);
  const ctp = settleCtp(rounds.map((r) => ({ roundId: r.id, teeSlot: r.teeSlot, ctp: r.ctp })), par3s(layout), rules.ctp);
  return { leaderboard, skins, ctp, ledger: [...placePayouts(leaderboard, rules.payouts), ...skins.ledger, ...ctp.ledger] };
}
