import { describe, expect, it } from 'vitest';
import { addDays, nextLeagueDay, scheduleDates } from '../src/lib/schedule';

describe('season schedule', () => {
  it('makes weekly dates, skipping off dates but keeping the number of weeks', () => {
    expect(addDays('2027-12-30', 7)).toBe('2028-01-06');
    expect(scheduleDates('2027-04-29', 3, new Set())).toEqual({ dates: ['2027-04-29', '2027-05-06', '2027-05-13'], all: ['2027-04-29', '2027-05-06', '2027-05-13'] });
    expect(scheduleDates('2027-06-24', 3, new Set(['2027-07-01']))).toEqual({
      dates: ['2027-06-24', '2027-07-08', '2027-07-15'],
      all: ['2027-06-24', '2027-07-01', '2027-07-08', '2027-07-15'],
    });
  });

  it('finds the next league night', () => {
    expect(nextLeagueDay('2027-04-26', 4)).toBe('2027-04-29'); // Monday → Thursday
    expect(nextLeagueDay('2027-04-29', 4)).toBe('2027-04-29'); // already Thursday
    expect(nextLeagueDay('2027-04-30', 4)).toBe('2027-05-06');
  });
});
