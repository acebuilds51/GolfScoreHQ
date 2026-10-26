import { splitEvenly } from './money';
import type { SkinsRules } from './rules';
import type { Cents, HoleScores, LedgerEntry, PlayerId } from './types';

/** Anything that can win a skin: one player's ball, or one team's scramble score. */
export interface SkinsCompetitor {
  id: string;
  playerIds: PlayerId[];
  scores: HoleScores;
  roundId?: string;
}

export interface SkinWin {
  holeIndex: number;
  holeNumber: number;
  competitorId: string;
  playerIds: PlayerId[];
  value: Cents;
}

export interface SkinsResult {
  wins: SkinWin[];
  /** Pot money nobody won (e.g. ties on the last hole with carryover). */
  unawarded: Cents;
  ledger: LedgerEntry[];
}

function uniqueLow(competitors: SkinsCompetitor[], holeIndex: number): SkinsCompetitor | null {
  let best: number | null = null;
  let holders: SkinsCompetitor[] = [];
  for (const c of competitors) {
    const s = c.scores[holeIndex];
    if (s == null) continue;
    if (best === null || s < best) {
      best = s;
      holders = [c];
    } else if (s === best) {
      holders.push(c);
    }
  }
  return holders.length === 1 ? holders[0]! : null;
}

export function settleSkins(competitors: SkinsCompetitor[], holeNumbers: number[], rules: SkinsRules): SkinsResult {
  const empty: SkinsResult = { wins: [], unawarded: 0, ledger: [] };
  if (!rules.enabled || !competitors.length) return empty;

  const holeWinners = holeNumbers.map((_, i) => uniqueLow(competitors, i));
  const wins: SkinWin[] = [];
  let unawarded: Cents = 0;

  if (rules.payout === 'splitPot') {
    const won = holeWinners.map((c, i) => ({ c, i })).filter((x) => x.c !== null);
    if (!won.length) return { ...empty, unawarded: rules.pot };
    const values = splitEvenly(rules.pot, won.length);
    won.forEach(({ c, i }, k) =>
      wins.push({ holeIndex: i, holeNumber: holeNumbers[i]!, competitorId: c!.id, playerIds: c!.playerIds, value: values[k]! }),
    );
  } else {
    const perHole = splitEvenly(rules.pot, holeNumbers.length);
    let carry: Cents = 0;
    holeWinners.forEach((c, i) => {
      const value = perHole[i]! + carry;
      if (c) {
        wins.push({ holeIndex: i, holeNumber: holeNumbers[i]!, competitorId: c.id, playerIds: c.playerIds, value });
        carry = 0;
      } else if (rules.tieRule === 'carryover') {
        carry = value;
      } else {
        unawarded += value;
      }
    });
    unawarded += carry;
  }

  const ledger: LedgerEntry[] = [];
  const byCompetitor = new Map(competitors.map((c) => [c.id, c]));
  for (const w of wins) {
    const shares = splitEvenly(w.value, w.playerIds.length);
    const roundId = byCompetitor.get(w.competitorId)?.roundId;
    w.playerIds.forEach((playerId, k) =>
      ledger.push({ playerId, amount: shares[k]!, kind: 'skin', holeNumber: w.holeNumber, roundId }),
    );
  }
  return { wins, unawarded, ledger };
}
