import type { Cents, LedgerEntry, PlayerId } from './types';

export function dollars(amount: number): Cents {
  return Math.round(amount * 100);
}

/**
 * Split a non-negative amount into n parts that differ by at most one cent.
 * Leftover cents go to the earliest parts, so results are deterministic.
 */
export function splitEvenly(total: Cents, n: number): Cents[] {
  if (n <= 0) return [];
  if (total < 0) throw new Error('splitEvenly expects a non-negative total');
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Settle a "per man" wager between two sides so the result always nets to zero.
 * Equal sides: each winner +stake, each loser -stake.
 * Unequal sides (e.g. 2 vs 1): the pot is stake x the larger side's size, and
 * each side splits it evenly, so a lone player covers every opponent.
 */
export function settleWager(
  winners: PlayerId[],
  losers: PlayerId[],
  stake: Cents,
  base: Omit<LedgerEntry, 'playerId' | 'amount'>,
): LedgerEntry[] {
  if (!winners.length || !losers.length || stake <= 0) return [];
  const pot = stake * Math.max(winners.length, losers.length);
  const won = splitEvenly(pot, winners.length);
  const lost = splitEvenly(pot, losers.length);
  return [
    ...winners.map((playerId, i) => ({ ...base, playerId, amount: won[i]! })),
    ...losers.map((playerId, i) => ({ ...base, playerId, amount: -lost[i]! })),
  ];
}

export function totalsByPlayer(entries: LedgerEntry[]): Record<PlayerId, Cents> {
  const totals: Record<PlayerId, Cents> = {};
  for (const e of entries) totals[e.playerId] = (totals[e.playerId] ?? 0) + e.amount;
  return totals;
}
