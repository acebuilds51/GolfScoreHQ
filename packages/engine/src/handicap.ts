// World Handicap System (WHS) calculations.
// Differentials are computed per 18 holes. Nine-hole rounds are combined in
// pairs (in the order played) into one 18-hole differential, which is how
// WHS treated 9-hole scores before the 2024 "expected score" method. The
// expected-score method needs USGA lookup tables and is a later addition.

export interface ScoreRecord {
  /** Adjusted gross score for the round. */
  score: number;
  rating: number;
  slope: number;
  holes: 9 | 18;
  /** Playing Conditions Calculation adjustment, usually 0. */
  pcc?: number;
}

export function scoreDifferential(score: number, rating: number, slope: number, pcc = 0): number {
  return Math.round(((113 / slope) * (score - rating - pcc)) * 10) / 10;
}

/** Turn a history of 9- and 18-hole scores into 18-hole differentials, oldest first. */
export function differentialsFrom(records: ScoreRecord[]): number[] {
  const out: number[] = [];
  let pendingNine: ScoreRecord | null = null;
  for (const r of records) {
    if (r.holes === 18) {
      out.push(scoreDifferential(r.score, r.rating, r.slope, r.pcc ?? 0));
    } else if (!pendingNine) {
      pendingNine = r;
    } else {
      const score = pendingNine.score + r.score;
      const rating = pendingNine.rating + r.rating;
      const slope = Math.round((pendingNine.slope + r.slope) / 2);
      out.push(scoreDifferential(score, rating, slope, (pendingNine.pcc ?? 0) + (r.pcc ?? 0)));
      pendingNine = null;
    }
  }
  return out;
}

// WHS table: how many of the most recent (up to 20) differentials to average,
// and the adjustment applied for small record counts.
const WHS_TABLE: Record<number, { use: number; adjust: number }> = {
  3: { use: 1, adjust: -2 },
  4: { use: 1, adjust: -1 },
  5: { use: 1, adjust: 0 },
  6: { use: 2, adjust: -1 },
  7: { use: 2, adjust: 0 },
  8: { use: 2, adjust: 0 },
  9: { use: 3, adjust: 0 },
  10: { use: 3, adjust: 0 },
  11: { use: 3, adjust: 0 },
  12: { use: 4, adjust: 0 },
  13: { use: 4, adjust: 0 },
  14: { use: 4, adjust: 0 },
  15: { use: 5, adjust: 0 },
  16: { use: 5, adjust: 0 },
  17: { use: 6, adjust: 0 },
  18: { use: 6, adjust: 0 },
  19: { use: 7, adjust: 0 },
  20: { use: 8, adjust: 0 },
};

export const MAX_HANDICAP_INDEX = 54;

/** Handicap Index from 18-hole differentials (oldest first). Null until 3 are available. */
export function handicapIndex(differentials: number[]): number | null {
  const recent = differentials.slice(-20);
  const row = WHS_TABLE[recent.length];
  if (!row) return null;
  const best = [...recent].sort((a, b) => a - b).slice(0, row.use);
  const avg = best.reduce((s, d) => s + d, 0) / best.length + row.adjust;
  // WHS rounds the Handicap Index to the nearest tenth.
  const index = Math.round(avg * 10) / 10;
  return Math.min(index, MAX_HANDICAP_INDEX);
}

/** Course Handicap for an 18-hole set: Index x Slope / 113 + (Rating - Par). */
export function courseHandicap(index: number, slope: number, rating: number, par: number): number {
  return Math.round((index * slope) / 113 + (rating - par));
}

/** Nine-hole Course Handicap: half the Index, with the nine's rating, slope and par. */
export function nineHoleCourseHandicap(index: number, slope: number, rating: number, par: number): number {
  return Math.round(((index / 2) * slope) / 113 + (rating - par));
}
