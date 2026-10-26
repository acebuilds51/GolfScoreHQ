import type { CtpRules } from './rules';
import type { CtpClaim, CtpReport, LedgerEntry, PlayerId } from './types';

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
  /**
   * The claims don't resolve to one winner: two groups at the same latest tee slot
   * (latestTeeSlot), or more than one unbeaten claim / a loop (markerChain).
   * Needs a commissioner decision.
   */
  conflict: boolean;
  /** Players whose claims are still in contention when there is a conflict. */
  contenders: PlayerId[];
}

export interface CtpResult {
  holes: CtpHoleResult[];
  ledger: LedgerEntry[];
}

interface Claim {
  source: CtpClaimSource;
  winner: PlayerId;
  beat: PlayerId | null;
}

function toClaim(source: CtpClaimSource, report: CtpReport | undefined): Claim | null {
  if (!report || report === 'none') return null;
  if (typeof report === 'string') return { source, winner: report, beat: null };
  return { source, winner: (report as CtpClaim).winner, beat: (report as CtpClaim).beat };
}

function noWinner(holeNumber: number, conflict = false, contenders: PlayerId[] = [], teeSlot: number | null = null): CtpHoleResult {
  return { holeNumber, winner: null, teeSlot, roundId: null, conflict, contenders };
}

function won(holeNumber: number, c: Claim): CtpHoleResult {
  return { holeNumber, winner: c.winner, teeSlot: c.source.teeSlot, roundId: c.source.roundId, conflict: false, contenders: [] };
}

/** The winner is the single claim whose player nobody else claims to have beaten. */
function resolveMarkerChain(holeNumber: number, claims: Claim[]): CtpHoleResult {
  const beaten = new Set(claims.map((c) => c.beat).filter((b): b is PlayerId => b !== null));
  const unbeaten = claims.filter((c) => !beaten.has(c.winner));
  const distinct = [...new Set(unbeaten.map((c) => c.winner))];
  if (distinct.length === 1) return won(holeNumber, unbeaten[unbeaten.length - 1]!);
  // Several unbeaten claims (e.g. two groups both "inside of Al"), or a loop where everyone was beaten.
  return noWinner(holeNumber, true, distinct.length ? distinct : [...new Set(claims.map((c) => c.winner))]);
}

function resolveLatestTeeSlot(holeNumber: number, claims: Claim[]): CtpHoleResult {
  const latest = Math.max(...claims.map((c) => c.source.teeSlot));
  const atLatest = claims.filter((c) => c.source.teeSlot === latest);
  const distinct = [...new Set(atLatest.map((c) => c.winner))];
  if (distinct.length > 1) return noWinner(holeNumber, true, distinct, latest);
  return won(holeNumber, atLatest[0]!);
}

export function settleCtp(sources: CtpClaimSource[], par3HoleNumbers: number[], rules: CtpRules): CtpResult {
  if (!rules.enabled) return { holes: [], ledger: [] };

  const holes = par3HoleNumbers.map((holeNumber): CtpHoleResult => {
    const claims = sources.map((s) => toClaim(s, s.ctp?.[holeNumber])).filter((c): c is Claim => c !== null);
    if (!claims.length) return noWinner(holeNumber);
    return rules.resolution === 'markerChain' ? resolveMarkerChain(holeNumber, claims) : resolveLatestTeeSlot(holeNumber, claims);
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
