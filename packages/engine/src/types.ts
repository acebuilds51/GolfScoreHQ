// Core domain types shared across the engine.
// The engine is pure: no I/O, no dates from the clock, no globals.
// Every function takes inputs and a rules object and returns results.

/** All money is integer cents to avoid floating-point drift. */
export type Cents = number;

export type PlayerId = string;

export interface Hole {
  number: number;
  par: number;
  /** Handicap stroke index (1 = hardest). Optional until net formats ship. */
  strokeIndex?: number;
}

/** A nine (or a full 18) that a round is played on. */
export interface Layout {
  id: string;
  name: string;
  holes: Hole[];
  /** Course rating for this layout (9-hole rating for a nine). */
  rating?: number;
  slope?: number;
}

export type Side = 'A' | 'B';

/** A score of null means the player did not play / did not record that hole. */
export type HoleScores = (number | null)[];

export interface MatchRoundPlayer {
  id: PlayerId;
  /** Match side. Omitted for players who are in skins/CTP only (OCBC's "player 5"). */
  side?: Side;
}

export interface PressInput {
  /** 0-based index of the hole the press starts on (inclusive). */
  startHoleIndex: number;
  calledBy: Side;
}

/**
 * A group's claim on a par 3: their player is inside the marker left by
 * `beat` (null = there was no marker yet; they were first on the green).
 */
export interface CtpClaim {
  winner: PlayerId;
  beat: PlayerId | null;
}

/**
 * CTP report from one group for one par 3: 'none' (nobody in the group beat the
 * marker), a bare player id (tee-order leagues), or a claim (marker-chain leagues).
 */
export type CtpReport = PlayerId | 'none' | CtpClaim;

/** One group's round in a best-ball match format. */
export interface MatchRoundInput {
  id: string;
  teeSlot: number;
  players: MatchRoundPlayer[];
  scores: Record<PlayerId, HoleScores>;
  presses?: PressInput[];
  /** Keyed by hole number. */
  ctp?: Record<number, CtpReport>;
}

/** One team's round in a scramble: one score per hole for the whole team. */
export interface ScrambleRoundInput {
  id: string;
  teeSlot: number;
  players: PlayerId[];
  teamScores: HoleScores;
  ctp?: Record<number, CtpReport>;
}

export type LedgerKind = 'match' | 'press' | 'skin' | 'ctp' | 'scramblePot';

export interface LedgerEntry {
  playerId: PlayerId;
  /** Positive = player is owed money, negative = player owes. */
  amount: Cents;
  kind: LedgerKind;
  roundId?: string;
  holeNumber?: number;
}
