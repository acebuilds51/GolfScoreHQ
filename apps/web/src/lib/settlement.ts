import { settleBestBallWeek, settleIndividualWeek, type FormatRules, type PlacedLine } from '@golfscorehq/engine';
import { asBestBall, individualRules, toEngineRound } from './scoring';
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
  skin: number;
  ctp: number;
  total: number;
}

export interface WeekSettlement {
  entries: LedgerRow[];
  skins: { holeNumber: number; playerId: string; value: number }[];
  skinsUnawarded: number;
  ctp: CtpOutcome[];
  totals: PlayerTotals[];
  /** Stroke play and Stableford: the week's finishing order (empty for match formats). */
  leaderboard: PlacedLine[];
  /** Groups still scoring; their scores so far are included. */
  unsubmitted: number;
}

const TOTAL_KINDS = ['match', 'press', 'place', 'skin', 'ctp'] as const;

/** Settle a week with the engine, applying the commissioner's CTP decisions. */
export function settleWeek(rounds: RoundData[], layout: Layout, rulesIn: FormatRules, decisions: Record<number, string> = {}): WeekSettlement {
  const ind = individualRules(rulesIn);
  const engineRounds = rounds.map((r) => toEngineRound(r, layout));
  const engineLayout = { id: layout.id, name: layout.name, holes: layout.holes };
  const week = ind ? settleIndividualWeek(engineRounds, engineLayout, ind) : settleBestBallWeek(engineRounds, engineLayout, asBestBall(rulesIn));
  const ctpAmount = rulesIn.ctp.amountPerHole;

  const entries: LedgerRow[] = week.ledger.map((e) => ({
    playerId: e.playerId, roundId: e.roundId ?? null, kind: e.kind as LedgerKind, amountCents: e.amount, holeNumber: e.holeNumber ?? null,
  }));

  const ctp: CtpOutcome[] = week.ctp.holes.map((h) => {
    const pick = decisions[h.holeNumber];
    if (h.conflict && pick && h.contenders.includes(pick)) {
      const round = rounds.find((r) => r.players.some((p) => p.playerId === pick));
      if (ctpAmount > 0) entries.push({ playerId: pick, roundId: round?.id ?? null, kind: 'ctp', amountCents: ctpAmount, holeNumber: h.holeNumber });
      return { holeNumber: h.holeNumber, winner: pick, disputed: false, contenders: h.contenders, decided: true };
    }
    return { holeNumber: h.holeNumber, winner: h.winner, disputed: h.conflict, contenders: h.contenders, decided: false };
  });

  return {
    entries,
    skins: week.skins.wins.map((w) => ({ holeNumber: w.holeNumber, playerId: w.playerIds[0]!, value: w.value })),
    skinsUnawarded: week.skins.unawarded,
    ctp,
    totals: totalsFromLedger(entries),
    leaderboard: 'leaderboard' in week ? week.leaderboard : [],
    unsubmitted: rounds.filter((r) => r.status !== 'submitted').length,
  };
}

/** Rebuild the same per-player view from saved ledger rows (what everyone sees after settling). */
export function totalsFromLedger(rows: LedgerRow[]): PlayerTotals[] {
  const byPlayer = new Map<string, PlayerTotals>();
  for (const e of rows) {
    const t = byPlayer.get(e.playerId) ?? { playerId: e.playerId, match: 0, press: 0, place: 0, skin: 0, ctp: 0, total: 0 };
    if ((TOTAL_KINDS as readonly string[]).includes(e.kind)) t[e.kind as (typeof TOTAL_KINDS)[number]] += e.amountCents;
    t.total += e.amountCents;
    byPlayer.set(e.playerId, t);
  }
  return [...byPlayer.values()].sort((a, b) => b.total - a.total);
}
