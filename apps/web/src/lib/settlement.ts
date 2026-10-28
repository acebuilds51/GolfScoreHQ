import { weekPosting, type FormatRules, type PlacedLine, type ScrambleTeamLine } from '@golfscorehq/engine';
import { toEngineRound } from './scoring';
import type { Layout, LedgerKind, LedgerRow, RoundData } from './types';

export interface CtpOutcome {
  holeNumber: number;
  winner: string | null;
  /** Two groups claimed the same marker and nobody has decided yet. */
  disputed: boolean;
  contenders: string[];
  /** The commissioner picked the winner of a disputed hole. */
  decided: boolean;
}

export interface PlayerTotals {
  playerId: string;
  match: number;
  press: number;
  place: number;
  /** Scramble team prize money. */
  scramblePot: number;
  skin: number;
  ctp: number;
  total: number;
}

export interface WeekSettlement {
  entries: LedgerRow[];
  /** playerIds: everyone sharing the skin (a scramble team); playerId is the first of them. */
  skins: { holeNumber: number; playerId: string; playerIds: string[]; value: number }[];
  skinsUnawarded: number;
  ctp: CtpOutcome[];
  totals: PlayerTotals[];
  /** Stroke play and Stableford: the week's finishing order (empty for match formats). */
  leaderboard: PlacedLine[];
  /** Scramble: the teams' finishing order (empty for other formats). */
  teams: ScrambleTeamLine[];
  /** Groups still scoring; their scores so far are included. */
  unsubmitted: number;
}

const TOTAL_KINDS = ['match', 'press', 'place', 'scramblePot', 'skin', 'ctp'] as const;

/** Settle a week with the engine, applying the commissioner's CTP decisions. */
export function settleWeek(rounds: RoundData[], layout: Layout, rulesIn: FormatRules, decisions: Record<number, string> = {}): WeekSettlement {
  const engineRounds = rounds.map((r) => toEngineRound(r, layout));
  const engineLayout = { id: layout.id, name: layout.name, holes: layout.holes };
  const posting = weekPosting(engineRounds, engineLayout, rulesIn, decisions);
  const week = posting.week;

  const entries: LedgerRow[] = posting.ledger.map((e) => ({
    playerId: e.playerId, roundId: e.roundId ?? null, kind: e.kind as LedgerKind, amountCents: e.amount, holeNumber: e.holeNumber ?? null,
  }));

  const ctp: CtpOutcome[] = week.ctp.holes.map((h) => {
    const pick = decisions[h.holeNumber];
    if (h.conflict && pick && h.contenders.includes(pick)) {
      return { holeNumber: h.holeNumber, winner: pick, disputed: false, contenders: h.contenders, decided: true };
    }
    return { holeNumber: h.holeNumber, winner: h.winner, disputed: h.conflict, contenders: h.contenders, decided: false };
  });

  return {
    entries,
    skins: week.skins.wins.map((w) => ({ holeNumber: w.holeNumber, playerId: w.playerIds[0]!, playerIds: w.playerIds, value: w.value })),
    skinsUnawarded: week.skins.unawarded,
    ctp,
    totals: totalsFromLedger(entries),
    leaderboard: 'leaderboard' in week ? week.leaderboard : [],
    teams: 'standings' in week ? week.standings : [],
    unsubmitted: rounds.filter((r) => r.status !== 'submitted').length,
  };
}

/** Rebuild the same per-player view from saved ledger rows (what everyone sees after settling). */
export function totalsFromLedger(rows: LedgerRow[]): PlayerTotals[] {
  const byPlayer = new Map<string, PlayerTotals>();
  for (const e of rows) {
    const t = byPlayer.get(e.playerId) ?? { playerId: e.playerId, match: 0, press: 0, place: 0, scramblePot: 0, skin: 0, ctp: 0, total: 0 };
    if ((TOTAL_KINDS as readonly string[]).includes(e.kind)) t[e.kind as (typeof TOTAL_KINDS)[number]] += e.amountCents;
    t.total += e.amountCents;
    byPlayer.set(e.playerId, t);
  }
  return [...byPlayer.values()].sort((a, b) => b.total - a.total);
}
