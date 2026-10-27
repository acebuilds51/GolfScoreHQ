import type { Cents } from './types';

// League rules are data, not code. Each league season stores a frozen copy of
// its rules so past weeks always recalculate under the rules they were played with.
// New formats extend these unions; they never fork the engine per league.

export interface SkinsRules {
  enabled: boolean;
  /**
   * noSkin: a tied low score means nobody wins that hole.
   * carryover: a tied hole's value rolls onto the next hole.
   */
  tieRule: 'noSkin' | 'carryover';
  /**
   * splitPot: the whole pot is divided evenly among the skins that were won.
   * perHole: each hole is worth pot / holes (plus any carryover).
   */
  payout: 'splitPot' | 'perHole';
  pot: Cents;
}

export interface CtpRules {
  enabled: boolean;
  amountPerHole: Cents;
  /**
   * markerChain: each claim names whose marker it beat. The winner is the one
   * claim nobody else beat, so tee order and entry order don't matter.
   * latestTeeSlot: groups report their own closest player; the group with the
   * highest tee slot that reported a winner takes it.
   */
  resolution: 'markerChain' | 'latestTeeSlot';
}

/**
 * Handicaps. Each golfer's Course Handicap is fixed when their group starts
 * (from GHIN or the league's own calculation); these rules decide how many of
 * those strokes count and where.
 */
export interface HandicapRules {
  enabled: boolean;
  /** Share of each Course Handicap a golfer gets, in percent (100 = full, 90 and 85 are common for matches). */
  allowance: number;
  /**
   * offLow: everyone in the match plays off the lowest handicap in the group (usual for match play).
   * full: each golfer gets all their own strokes.
   * gross: no strokes in the match.
   */
  match: 'offLow' | 'full' | 'gross';
  /** Skins on gross or net scores (net uses each golfer's own strokes). */
  skins: 'gross' | 'net';
  /**
   * Where each golfer's Handicap Index comes from when a group starts:
   * ghinFirst: the index the commissioner entered (GHIN), else one calculated from league rounds.
   * ghin: only entered indexes. league: only the league's own calculation.
   */
  source?: 'ghinFirst' | 'ghin' | 'league';
}

export interface BestBallMatchRules {
  format: 'bestBallMatch';
  /** How a group's hole is decided: lowest single ball on each side. */
  holeScoring: 'bestBall';
  match: { stake: Cents };
  presses: { enabled: boolean; stake: Cents };
  skins: SkinsRules;
  ctp: CtpRules;
  /** Missing on seasons set up before handicaps existed: those play gross. */
  handicaps?: HandicapRules;
}

export interface ScrambleRules {
  format: 'scramble';
  /** Paid to the team with the lowest total (split on a tie). */
  teamPot: Cents;
  skins: SkinsRules;
  ctp: CtpRules;
}

export type FormatRules = BestBallMatchRules | ScrambleRules;
