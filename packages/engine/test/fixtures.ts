import type { Layout, MatchRoundInput, PlayerId } from '../src';

// Crystal Lake nines as used by the OCBC league (par 35 each).
export const FRONT: Layout = {
  id: 'front',
  name: 'Front 9',
  holes: [4, 3, 5, 4, 3, 4, 4, 4, 4].map((par, i) => ({ number: i + 1, par })),
};

export const BACK: Layout = {
  id: 'back',
  name: 'Back 9',
  holes: [4, 4, 3, 5, 3, 4, 3, 5, 4].map((par, i) => ({ number: i + 10, par })),
};

/** Scores for each hole of the front nine, par everywhere unless overridden. */
export function parRound(overrides: Record<number, number> = {}): number[] {
  return FRONT.holes.map((h, i) => overrides[i] ?? h.par);
}

export function round(
  id: string,
  teeSlot: number,
  sides: { A: PlayerId[]; B: PlayerId[]; skinsOnly?: PlayerId[] },
  scores: Record<PlayerId, (number | null)[]>,
  extra: Partial<MatchRoundInput> = {},
): MatchRoundInput {
  return {
    id,
    teeSlot,
    players: [
      ...sides.A.map((id) => ({ id, side: 'A' as const })),
      ...sides.B.map((id) => ({ id, side: 'B' as const })),
      ...(sides.skinsOnly ?? []).map((id) => ({ id })),
    ],
    scores,
    ...extra,
  };
}
