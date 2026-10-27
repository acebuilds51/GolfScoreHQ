import { settleCtp, type CtpResult } from './ctp';
import { splitEvenly } from './money';
import { strokesByHole } from './net';
import type { ScrambleRules } from './rules';
import { settleSkins, type SkinsCompetitor, type SkinsResult } from './skins';
import type { Cents, Hole, Layout, LedgerEntry, MatchRoundInput, PlayerId, ScrambleRoundInput } from './types';
import { par3s } from './week';

// Scramble: each group is a team playing one ball, with one score per hole.

/**
 * Share of each player's Course Handicap that goes into the team handicap,
 * lowest handicap first. Twos and fours are the USGA recommendations; threes
 * use the common 20/15/10.
 */
export const SCRAMBLE_WEIGHTS: Record<number, number[]> = {
  1: [100],
  2: [35, 15],
  3: [20, 15, 10],
  4: [25, 20, 15, 10],
  5: [25, 20, 15, 10, 5],
};

/** Team handicap from the players' Course Handicaps (no handicap counts as 0). */
export function teamHandicap(courseHandicaps: (number | null | undefined)[]): number {
  const sorted = courseHandicaps.map((c) => c ?? 0).sort((a, b) => a - b);
  const weights = SCRAMBLE_WEIGHTS[Math.min(sorted.length, 5)] ?? [];
  return Math.round(sorted.reduce((sum, ch, i) => sum + (ch * (weights[i] ?? 0)) / 100, 0));
}

/**
 * A scramble team's round from the per-player shape the app stores (the team
 * score is saved for every player): each hole's score is the first one recorded.
 */
export function scrambleRoundFrom(r: MatchRoundInput): ScrambleRoundInput {
  const holes = Math.max(0, ...Object.values(r.scores).map((s) => s.length));
  const teamScores = Array.from({ length: holes }, (_, i) => {
    for (const p of r.players) {
      const v = r.scores[p.id]?.[i];
      if (v != null) return v;
    }
    return null;
  });
  return {
    id: r.id, teeSlot: r.teeSlot, players: r.players.map((p) => p.id), teamScores,
    ...(r.ctp ? { ctp: r.ctp } : {}),
    ...(r.courseHandicaps ? { courseHandicaps: r.courseHandicaps } : {}),
  };
}

export interface ScrambleTeamLine {
  roundId: string;
  teeSlot: number;
  players: PlayerId[];
  /** Holes with a score. */
  thru: number;
  complete: boolean;
  /** Gross team strokes on the holes played. */
  total: number;
  grossToPar: number;
  /** Team handicap strokes received on the holes played (0 playing gross). */
  strokes: number;
  /** Net to par with handicaps on, otherwise gross. Teams rank on this. */
  toPar: number;
  /** Finishing place, shared on a tie; null for a team that hasn't finished. */
  place: number | null;
  tied: boolean;
}

const netOn = (rules: ScrambleRules) => !!rules.handicaps?.enabled;

/** Strokes the team gets on each hole. */
export function teamStrokesByHole(r: ScrambleRoundInput, holes: Hole[], rules: ScrambleRules): number[] {
  if (!netOn(rules)) return holes.map(() => 0);
  return strokesByHole(teamHandicap(r.players.map((p) => r.courseHandicaps?.[p])), holes);
}

/** Every team's round so far, ranked: finished teams first (ties share a place), then the rest. */
export function scrambleStandings(rounds: ScrambleRoundInput[], holes: Hole[], rules: ScrambleRules): ScrambleTeamLine[] {
  const lines = rounds.map((r) => {
    const given = teamStrokesByHole(r, holes, rules);
    let thru = 0, total = 0, par = 0, strokes = 0;
    holes.forEach((h, i) => {
      const s = r.teamScores[i];
      if (s == null) return;
      thru++;
      total += s;
      par += h.par;
      strokes += given[i] ?? 0;
    });
    return {
      roundId: r.id, teeSlot: r.teeSlot, players: r.players, thru, complete: holes.length > 0 && thru === holes.length,
      total, grossToPar: total - par, strokes, toPar: total - par - strokes, place: null as number | null, tied: false,
    };
  });
  const done = lines.filter((l) => l.complete).sort((a, b) => a.toPar - b.toPar || a.teeSlot - b.teeSlot);
  const rest = lines.filter((l) => !l.complete).sort((a, b) => b.thru - a.thru || a.toPar - b.toPar || a.teeSlot - b.teeSlot);
  for (const l of done) {
    const same = done.filter((x) => x.toPar === l.toPar);
    l.place = done.indexOf(same[0]!) + 1;
    l.tied = same.length > 1;
  }
  return [...done, ...rest];
}

/** Prize money by place: payouts when set, otherwise the single team pot for 1st. */
export function scramblePayouts(rules: ScrambleRules): Cents[] {
  return rules.payouts?.length ? rules.payouts : rules.teamPot > 0 ? [rules.teamPot] : [];
}

export interface ScrambleWeekResult {
  standings: ScrambleTeamLine[];
  /** Every team tied for 1st. */
  winners: ScrambleTeamLine[];
  skins: SkinsResult;
  ctp: CtpResult;
  ledger: LedgerEntry[];
}

export function settleScrambleWeek(rounds: ScrambleRoundInput[], layout: Layout, rules: ScrambleRules): ScrambleWeekResult {
  const standings = scrambleStandings(rounds, layout.holes, rules);
  const winners = standings.filter((s) => s.place === 1);

  // Each place's money: tied teams share the places they cover, then each team splits its share.
  const ledger: LedgerEntry[] = [];
  const payouts = scramblePayouts(rules);
  const places = [...new Set(standings.map((s) => s.place).filter((p): p is number => p !== null))];
  for (const place of places) {
    const tied = standings.filter((s) => s.place === place);
    const pot = payouts.slice(place - 1, place - 1 + tied.length).reduce((s, c) => s + Math.max(0, c), 0);
    if (pot <= 0) continue;
    const perTeam = splitEvenly(pot, tied.length);
    tied.forEach((team, t) => {
      const shares = splitEvenly(perTeam[t]!, team.players.length);
      team.players.forEach((playerId, k) => ledger.push({ playerId, amount: shares[k]!, kind: 'scramblePot', roundId: team.roundId }));
    });
  }

  // Team skins, net with the team's strokes when the league plays net skins.
  const netSkins = netOn(rules) && rules.handicaps!.skins === 'net';
  const competitors: SkinsCompetitor[] = rounds.map((r) => {
    const given = netSkins ? teamStrokesByHole(r, layout.holes, rules) : null;
    return {
      id: r.id,
      playerIds: r.players,
      scores: given ? r.teamScores.map((s, i) => (s == null ? null : s - (given[i] ?? 0))) : r.teamScores,
      roundId: r.id,
    };
  });
  const skins = settleSkins(competitors, layout.holes.map((h) => h.number), rules.skins);
  const ctp = settleCtp(rounds.map((r) => ({ roundId: r.id, teeSlot: r.teeSlot, ctp: r.ctp })), par3s(layout), rules.ctp);

  ledger.push(...skins.ledger, ...ctp.ledger);
  return { standings, winners, skins, ctp, ledger };
}
