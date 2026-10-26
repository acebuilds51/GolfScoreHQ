import { describe, expect, it } from 'vitest';
import { courseHandicap, differentialsFrom, handicapIndex, scoreDifferential } from '../src';

describe('WHS handicap', () => {
  it('computes an 18-hole score differential', () => {
    expect(scoreDifferential(85, 70.1, 125)).toBe(13.5);
  });

  it('combines consecutive nine-hole rounds into one 18-hole differential', () => {
    const diffs = differentialsFrom([
      { score: 40, rating: 34.5, slope: 118, holes: 9 },
      { score: 42, rating: 34.8, slope: 120, holes: 9 },
      { score: 44, rating: 34.5, slope: 118, holes: 9 }, // unpaired, not counted yet
    ]);
    // 82 on a combined 69.3 / 119 layout.
    expect(diffs).toEqual([12.1]);
  });

  it('needs three differentials and applies the small-sample adjustment', () => {
    expect(handicapIndex([10, 12])).toBeNull();
    expect(handicapIndex([10, 12, 14])).toBe(8); // lowest 1, minus 2
    expect(handicapIndex([10, 12, 14, 9, 11, 15])).toBe(8.5); // avg of lowest 2 (9, 10), minus 1
  });

  it('averages the best 8 of the last 20 with no 0.96 multiplier', () => {
    const diffs = Array.from({ length: 25 }, (_, i) => i + 1); // only 6..25 count
    expect(handicapIndex(diffs)).toBe(9.5); // (6+7+...+13) / 8
  });

  it('caps the index at 54', () => {
    expect(handicapIndex([80, 81, 82])).toBe(54);
  });

  it('converts an index to a course handicap', () => {
    expect(courseHandicap(10, 118, 69.3, 70)).toBe(10);
  });
});
