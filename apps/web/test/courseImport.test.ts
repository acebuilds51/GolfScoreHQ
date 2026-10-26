import { describe, expect, it } from 'vitest';
import { normalizeCourse, normalizeSearch } from '../../../supabase/functions/course-lookup/normalize';
import { layoutsFromTee, rankWithinNine, teeLabel } from '../src/lib/courseImport';

// Shaped like a GolfCourseAPI course response.
const PARS = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4, 3, 4, 5, 4];
const HCPS = [7, 3, 17, 1, 11, 5, 15, 9, 13, 8, 2, 18, 6, 10, 16, 4, 12, 14];
const raw = {
  course: {
    id: 12345,
    club_name: 'Shepherds Hollow Golf Club',
    course_name: 'Main',
    location: { city: 'Clarkston', state: 'MI' },
    tees: {
      male: [
        { tee_name: 'White', course_rating: 71.2, slope_rating: 131, par_total: 72, holes: PARS.map((par, i) => ({ par, yardage: 350 + i, handicap: HCPS[i] })) },
        { tee_name: 'Broken', course_rating: 70, slope_rating: 120, holes: [{ par: 4 }] },
      ],
      female: [{ tee_name: 'Red', course_rating: '69.0', slope_rating: '118', holes: PARS.map((par) => ({ par, yardage: 300, handicap: null })) }],
    },
  },
};

describe('normalizing the lookup service', () => {
  it('keeps usable tees, skips broken ones, and reads string numbers', () => {
    const c = normalizeCourse(raw)!;
    expect(c).toMatchObject({ id: '12345', clubName: 'Shepherds Hollow Golf Club', courseName: 'Main', city: 'Clarkston', state: 'MI' });
    expect(c.tees.map((t) => [t.gender, t.name, t.rating, t.slope, t.holes.length])).toEqual([
      ['male', 'White', 71.2, 131, 18],
      ['female', 'Red', 69, 118, 18],
    ]);
  });

  it('reads search results', () => {
    expect(normalizeSearch({ courses: [raw.course, { nope: true }] })).toEqual([
      { id: '12345', clubName: 'Shepherds Hollow Golf Club', courseName: 'Main', city: 'Clarkston', state: 'MI' },
    ]);
  });
});

describe('building layouts from a set of tees', () => {
  const white = normalizeCourse(raw)!.tees[0]!;

  it('ranks stroke index within a nine', () => {
    expect(rankWithinNine([7, 3, 17, 1, 11, 5, 15, 9, 13])).toEqual([4, 2, 9, 1, 6, 3, 8, 5, 7]);
    expect(rankWithinNine([1, null, 3])).toBeNull();
  });

  it('splits an 18-hole scorecard into front and back nines with estimated ratings', () => {
    const [front, back] = layoutsFromTee(white, 'two-nines');
    expect(front).toMatchObject({ name: 'Front 9', firstHole: 1, pars: PARS.slice(0, 9), rating: 35.6, slope: 131, ratingEstimated: true });
    expect(back).toMatchObject({ name: 'Back 9', firstHole: 10, pars: PARS.slice(9), rating: 35.6, ratingEstimated: true });
    expect(back!.strokeIndexes).toEqual([4, 1, 9, 3, 5, 8, 2, 6, 7]);
  });

  it('keeps 18 holes as one layout with the real rating', () => {
    const [all] = layoutsFromTee(white, 'eighteen');
    expect(all).toMatchObject({ firstHole: 1, rating: 71.2, slope: 131, ratingEstimated: false, strokeIndexes: HCPS });
  });

  it('leaves stroke index empty when the scorecard has none', () => {
    const red = normalizeCourse(raw)!.tees[1]!;
    expect(layoutsFromTee(red, 'two-nines')[0]!.strokeIndexes).toBeNull();
  });

  it('labels tees for the picker', () => {
    expect(teeLabel(white)).toBe("White (men's) · 6,453 yds · 71.2 / 131");
  });
});
