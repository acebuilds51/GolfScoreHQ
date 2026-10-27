import { settleCtp, type CtpResult } from './ctp';
import { scoreMatch, type MatchResult } from './match';
import { splitEvenly } from './money';
import { netRound, ownStrokes } from './net';
import type { BestBallMatchRules, HandicapRules, ScrambleRules, SkinsRules } from './rules';
import { settleSkins, type SkinsCompetitor, type SkinsResult } from './skins';
import type { Cents, Layout, LedgerEntry, MatchRoundInput, PlayerId, ScrambleRoundInput } from './types';

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

export interface ScrambleTeamTotal {
  roundId: string;
  players: PlayerId[];
  total: number;
}

export interface ScrambleWeekResult {
  standings: ScrambleTeamTotal[];
  winners: ScrambleTeamTotal[];
  skins: SkinsResult;
  ctp: CtpResult;
  ledger: LedgerEntry[];
}

export function settleScrambleWeek(rounds: ScrambleRoundInput[], layout: Layout, rules: ScrambleRules): ScrambleWeekResult {
  const standings = rounds
    .map((r) => ({ roundId: r.id, players: r.players, total: r.teamScores.reduce<number>((s, v) => s + (v ?? 0), 0) }))
    .sort((x, y) => x.total - y.total);

  const best = standings[0]?.total;
  const winners = standings.filter((s) => s.total === best);
  const ledger: LedgerEntry[] = [];
  if (winners.length && rules.teamPot > 0) {
    // Split the pot across tied teams, then across each team's players.
    const perTeam = splitEvenly(rules.teamPot, winners.length);
    winners.forEach((team, t) => {
      const shares = splitEvenly(perTeam[t] as Cents, team.players.length);
      team.players.forEach((playerId, k) =>
        ledger.push({ playerId, amount: shares[k]!, kind: 'scramblePot', roundId: team.roundId }),
      );
    });
  }

  const competitors: SkinsCompetitor[] = rounds.map((r) => ({
    id: r.id,
    playerIds: r.players,
    scores: r.teamScores,
    roundId: r.id,
  }));
  const skins = settleSkins(competitors, layout.holes.map((h) => h.number), rules.skins);
  const ctp = settleCtp(rounds.map((r) => ({ roundId: r.id, teeSlot: r.teeSlot, ctp: r.ctp })), par3s(layout), rules.ctp);

  ledger.push(...skins.ledger, ...ctp.ledger);
  return { standings, winners, skins, ctp, ledger };
}
