import { settleCtp, type CtpResult } from './ctp';
import { scoreMatch, type MatchResult } from './match';
import { netRound, ownStrokes } from './net';
import type { BestBallMatchRules, HandicapRules, SkinsRules } from './rules';
import { settleSkins, type SkinsCompetitor, type SkinsResult } from './skins';
import type { Layout, LedgerEntry, MatchRoundInput } from './types';

export function par3s(layout: Layout): number[] {
  return layout.holes.filter((h) => h.par === 3).map((h) => h.number);
}

/**
 * Field-wide individual skins across every group. Net skins give each golfer
 * their own strokes (not off the low man). Skins-only players compete too.
 */
export function fieldSkins(rounds: MatchRoundInput[], layout: Layout, rules: SkinsRules, handicaps: HandicapRules | undefined): SkinsResult {
  const net = handicaps?.enabled && handicaps.skins === 'net';
  const competitors: SkinsCompetitor[] = rounds.flatMap((r) => {
    const scored = net ? netRound(r, layout.holes, ownStrokes(r, handicaps)) : r;
    return r.players.map((p) => ({
      id: `${r.id}:${p.id}`,
      playerIds: [p.id],
      scores: scored.scores[p.id] ?? [],
      roundId: r.id,
    }));
  });
  return settleSkins(competitors, layout.holes.map((h) => h.number), rules);
}

export interface BestBallWeekResult {
  matches: MatchResult[];
  skins: SkinsResult;
  ctp: CtpResult;
  ledger: LedgerEntry[];
}

/**
 * Settle one week of a best-ball match league: every group's match and presses,
 * plus field-wide individual skins and CTP across all groups.
 * Skins-only players (no side) still compete for skins and CTP.
 */
export function settleBestBallWeek(rounds: MatchRoundInput[], layout: Layout, rules: BestBallMatchRules): BestBallWeekResult {
  const holeCount = layout.holes.length;
  const matches = rounds.map((r) => scoreMatch(r, holeCount, rules, layout.holes));
  const skins = fieldSkins(rounds, layout, rules.skins, rules.handicaps);
  const ctp = settleCtp(rounds.map((r) => ({ roundId: r.id, teeSlot: r.teeSlot, ctp: r.ctp })), par3s(layout), rules.ctp);

  return {
    matches,
    skins,
    ctp,
    ledger: [...matches.flatMap((m) => m.ledger), ...skins.ledger, ...ctp.ledger],
  };
}

