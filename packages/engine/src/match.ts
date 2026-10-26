import { settleWager } from './money';
import type { BestBallMatchRules } from './rules';
import type { LedgerEntry, MatchRoundInput, PlayerId, Side } from './types';

export interface PressResult {
  startHoleIndex: number;
  calledBy: Side;
  holesWon: Record<Side, number>;
  winner: Side | null;
}

export interface MatchResult {
  roundId: string;
  /** null = halved, or no match on that hole. */
  holeWinners: (Side | null)[];
  holesWon: Record<Side, number>;
  /** null when halved or when there is no opposing side. */
  winner: Side | null;
  presses: PressResult[];
  ledger: LedgerEntry[];
}

export function sidePlayers(round: MatchRoundInput, side: Side): PlayerId[] {
  return round.players.filter((p) => p.side === side).map((p) => p.id);
}

/** Lowest score on a side for one hole, or null if nobody on that side recorded one. */
export function bestBall(round: MatchRoundInput, side: Side, holeIndex: number): number | null {
  let best: number | null = null;
  for (const id of sidePlayers(round, side)) {
    const s = round.scores[id]?.[holeIndex];
    if (s != null && (best === null || s < best)) best = s;
  }
  return best;
}

export function holeWinner(round: MatchRoundInput, holeIndex: number): Side | null {
  const a = bestBall(round, 'A', holeIndex);
  const b = bestBall(round, 'B', holeIndex);
  if (a === null && b === null) return null;
  // A side with no recorded score on a hole loses it (matches the OCBC app).
  if (b === null) return 'A';
  if (a === null) return 'B';
  return a < b ? 'A' : b < a ? 'B' : null;
}

function countWins(winners: (Side | null)[], from = 0): Record<Side, number> {
  const won = { A: 0, B: 0 };
  winners.slice(from).forEach((w) => {
    if (w) won[w]++;
  });
  return won;
}

function leader(won: Record<Side, number>): Side | null {
  return won.A > won.B ? 'A' : won.B > won.A ? 'B' : null;
}

export function scoreMatch(round: MatchRoundInput, holeCount: number, rules: BestBallMatchRules): MatchResult {
  const a = sidePlayers(round, 'A');
  const b = sidePlayers(round, 'B');
  const hasMatch = a.length > 0 && b.length > 0;

  const holeWinners = Array.from({ length: holeCount }, (_, i) => (hasMatch ? holeWinner(round, i) : null));
  const holesWon = countWins(holeWinners);
  const winner = hasMatch ? leader(holesWon) : null;

  const ledger: LedgerEntry[] = [];
  const pay = (w: Side | null, stake: number, kind: 'match' | 'press') => {
    if (!w) return;
    const [winners, losers] = w === 'A' ? [a, b] : [b, a];
    ledger.push(...settleWager(winners, losers, stake, { kind, roundId: round.id }));
  };

  pay(winner, rules.match.stake, 'match');

  const presses: PressResult[] = [];
  if (hasMatch && rules.presses.enabled) {
    for (const p of round.presses ?? []) {
      const won = countWins(holeWinners, p.startHoleIndex);
      const pressWinner = leader(won);
      presses.push({ startHoleIndex: p.startHoleIndex, calledBy: p.calledBy, holesWon: won, winner: pressWinner });
      pay(pressWinner, rules.presses.stake, 'press');
    }
  }

  return { roundId: round.id, holeWinners, holesWon, winner, presses, ledger };
}
