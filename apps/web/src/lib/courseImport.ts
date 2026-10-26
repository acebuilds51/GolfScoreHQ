import type { LookupTee } from '../../../../supabase/functions/course-lookup/normalize';

export type CourseShape = 'two-nines' | 'one-nine' | 'eighteen';

export interface ImportedLayout {
  name: string;
  tees: string;
  firstHole: number;
  pars: number[];
  /** Stroke index for each hole within this layout (1 = hardest), or null if the scorecard didn't have them. */
  strokeIndexes: number[] | null;
  rating: number | null;
  slope: number | null;
  /** True when the rating was estimated from the 18-hole rating and should be checked on the scorecard. */
  ratingEstimated: boolean;
}

/** Rank a nine's 18-hole stroke indexes 1–9 (the hardest hole on that nine gets 1). */
export function rankWithinNine(handicaps: (number | null)[]): number[] | null {
  if (handicaps.some((h) => h === null)) return null;
  const order = handicaps.map((h, i) => ({ h: h as number, i })).sort((a, b) => a.h - b.h);
  const ranks = new Array<number>(handicaps.length);
  order.forEach(({ i }, k) => (ranks[i] = k + 1));
  return ranks;
}

const half = (r: number | null) => (r === null ? null : Math.round((r / 2) * 10) / 10);

/**
 * Build the league's layouts from one set of tees. An 18-hole scorecard can be
 * split into front and back nines; the lookup service only has 18-hole
 * ratings, so a nine's rating is estimated at half (slope unchanged) and
 * flagged for the commissioner to check against the scorecard.
 */
export function layoutsFromTee(tee: LookupTee, shape: CourseShape): ImportedLayout[] {
  const tees = tee.name;
  const pars = tee.holes.map((h) => h.par);
  const handicaps = tee.holes.map((h) => h.handicap);

  if (tee.holes.length === 9) {
    return [{ name: '9 holes', tees, firstHole: 1, pars, strokeIndexes: rankWithinNine(handicaps), rating: tee.rating, slope: tee.slope, ratingEstimated: false }];
  }

  if (shape === 'eighteen') {
    const si = handicaps.every((h) => h !== null) ? (handicaps as number[]) : null;
    return [{ name: '18 holes', tees, firstHole: 1, pars, strokeIndexes: si, rating: tee.rating, slope: tee.slope, ratingEstimated: false }];
  }

  const nine = (name: string, from: number): ImportedLayout => ({
    name,
    tees,
    firstHole: from + 1,
    pars: pars.slice(from, from + 9),
    strokeIndexes: rankWithinNine(handicaps.slice(from, from + 9)),
    rating: half(tee.rating),
    slope: tee.slope,
    ratingEstimated: tee.rating !== null,
  });
  return shape === 'one-nine' ? [nine('Front 9', 0)] : [nine('Front 9', 0), nine('Back 9', 9)];
}

export function teeLabel(t: LookupTee): string {
  const yards = t.holes.reduce((s, h) => s + (h.yardage ?? 0), 0);
  const bits = [
    `${t.name} (${t.gender === 'male' ? "men's" : "women's"})`,
    yards ? `${yards.toLocaleString()} yds` : null,
    t.rating !== null && t.slope !== null ? `${t.rating} / ${t.slope}` : null,
    t.holes.length === 9 ? '9 holes' : null,
  ];
  return bits.filter(Boolean).join(' · ');
}
