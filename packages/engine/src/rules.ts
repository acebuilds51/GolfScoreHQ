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
   * latestTeeSlot: groups report their own closest player; the group with the
   * highest tee slot that reported a winner takes it (later groups saw the
   * earlier marker and only claim it if they beat it).
   */
  resolution: 'latestTeeSlot';
}

export interface BestBallMatchRules {
  format: 'bestBallMatch';
  /** How a group's hole is decided: lowest single ball on each side. */
  holeScoring: 'bestBall';
  match: { stake: Cents };
  presses: { enabled: boolean; stake: Cents };
  skins: SkinsRules;
  ctp: CtpRules;
}

export interface ScrambleRules {
  format: 'scramble';
  /** Paid to the team with the lowest total (split on a tie). */
  teamPot: Cents;
  skins: SkinsRules;
  ctp: CtpRules;
}

export type FormatRules = BestBallMatchRules | ScrambleRules;
