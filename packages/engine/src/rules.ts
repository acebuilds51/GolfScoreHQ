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
  /** Paid to the team with the lowest total (split on a tie). Used when there are no payouts by place. */
  teamPot: Cents;
  /**
   * Prize money by team finishing place, 1st first. Each team's share is split
   * evenly among its players; teams tied for a place share the places they cover.
   */
  payouts?: Cents[];
  skins: SkinsRules;
  ctp: CtpRules;
  /**
   * Net scramble: each team gets a team handicap from its players' Course
   * Handicaps (USGA weights, see teamHandicap). Only `enabled` and `skins` apply.
   */
  handicaps?: HandicapRules;
}

/** Stableford points for a hole, by the score against par (net or gross). */
export interface StablefordPoints {
  albatross: number;
  eagle: number;
  birdie: number;
  par: number;
  bogey: number;
  /** Double bogey or worse (including a pick-up). */
  double: number;
}

export const STANDARD_STABLEFORD: StablefordPoints = { albatross: 5, eagle: 4, birdie: 3, par: 2, bogey: 1, double: 0 };

/** What every individual format shares: each golfer plays their own ball against the whole field. */
interface IndividualRulesBase {
  /**
   * Prize money for the week's finishing places, 1st first (e.g. [3000, 2000, 1000]).
   * Golfers tied for a place share the money for the places they cover.
   */
  payouts: Cents[];
  skins: SkinsRules;
  ctp: CtpRules;
  /** With handicaps on, the leaderboard and places use net scores (each golfer's own strokes after the allowance). */
  handicaps?: HandicapRules;
}

/** Individual stroke play: lowest total (gross or net) wins. */
export interface StrokePlayRules extends IndividualRulesBase {
  format: 'strokePlay';
}

/** Individual Stableford: points per hole against par, most points wins. */
export interface StablefordRules extends IndividualRulesBase {
  format: 'stableford';
  points: StablefordPoints;
}

export type IndividualRules = StrokePlayRules | StablefordRules;

export type FormatRules = BestBallMatchRules | ScrambleRules | StrokePlayRules | StablefordRules;

export const isIndividual = (r: FormatRules): r is IndividualRules => r.format === 'strokePlay' || r.format === 'stableford';
