import type { CtpRules } from './rules';
import type { CtpReport, LedgerEntry, PlayerId } from './types';

export interface CtpClaimSource {
  roundId: string;
  teeSlot: number;
  ctp?: Record<number, CtpReport>;
}

export interface CtpHoleResult {
  holeNumber: number;
  winner: PlayerId | null;
  teeSlot: number | null;
  roundId: string | null;
  /** Two groups at the same (latest) tee slot both claimed it: needs a commissioner decision. */
  conflict: boolean;
}

export interface CtpResult {
  holes: CtpHoleResult[];
  ledger: LedgerEntry[];
}

export function settleCtp(sources: CtpClaimSource[], par3HoleNumbers: number[], rules: CtpRules): CtpResult {
  if (!rules.enabled) return { holes: [], ledger: [] };

  const holes = par3HoleNumbers.map((holeNumber): CtpHoleResult => {
    const claims = sources
      .map((s) => ({ s, report: s.ctp?.[holeNumber] }))
      .filter((x): x is { s: CtpClaimSource; report: PlayerId } => !!x.report && x.report !== 'none');
    if (!claims.length) return { holeNumber, winner: null, teeSlot: null, roundId: null, conflict: false };

    const latest = Math.max(...claims.map((c) => c.s.teeSlot));
    const atLatest = claims.filter((c) => c.s.teeSlot === latest);
    const distinctWinners = new Set(atLatest.map((c) => c.report));
    if (distinctWinners.size > 1) {
      return { holeNumber, winner: null, teeSlot: latest, roundId: null, conflict: true };
    }
    const c = atLatest[0]!;
    return { holeNumber, winner: c.report, teeSlot: latest, roundId: c.s.roundId, conflict: false };
  });

  const ledger: LedgerEntry[] = holes
    .filter((h) => h.winner && rules.amountPerHole > 0)
    .map((h) => ({
      playerId: h.winner!,
      amount: rules.amountPerHole,
      kind: 'ctp' as const,
      holeNumber: h.holeNumber,
      roundId: h.roundId ?? undefined,
    }));

  return { holes, ledger };
}
