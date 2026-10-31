import { describe, expect, it, vi } from 'vitest';

const remembered: string[] = [];
vi.mock('../src/lib/cache', () => ({ remember: (key: string) => void remembered.push(key) }));

const { isNetworkError } = await import('../src/lib/offline');
const { isAroundToday, rememberRound, rememberScoring, scoringCacheKey } = await import('../src/lib/scoringCache');

describe('no signal', () => {
  it('tells no signal apart from a refusal', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true); // iPhone
    const renew = Object.assign(new Error('fetch failed'), { name: 'AuthRetryableFetchError' });
    expect(isNetworkError(renew)).toBe(true); // the sign-in couldn't renew
    expect(isNetworkError(new Error('new row violates row-level security policy'))).toBe(false);
    expect(isNetworkError({ message: 'JWT expired' })).toBe(false);
  });
});

describe("saving each group's scoring screen on the phone", () => {
  const round = (id: string) => ({ id, eventId: 'E', teeSlot: 1, status: 'live' as const, currentHole: 0, players: [], scores: {}, presses: [], ctp: {}, submittedAt: null });

  it("saves every group of today's week, at most once a minute each", () => {
    remembered.length = 0;
    const week = { rounds: [round('A'), round('B')] };
    rememberScoring(week, ['A', 'B'], 1_000_000);
    rememberScoring(week, ['A', 'B'], 1_030_000);
    expect(remembered).toEqual([scoringCacheKey('A'), scoringCacheKey('B')]);
    rememberScoring(week, ['A'], 1_070_000);
    expect(remembered).toHaveLength(3);
  });

  it('the scoring screen saves every hole straight away', () => {
    remembered.length = 0;
    rememberRound({ rounds: [] }, round('C'));
    rememberRound({ rounds: [] }, round('C'));
    expect(remembered).toEqual([scoringCacheKey('C'), scoringCacheKey('C')]);
  });

  it("only bothers with this week's league night", () => {
    const now = new Date('2026-11-03T18:00:00');
    expect(isAroundToday('2026-11-03', now)).toBe(true);
    expect(isAroundToday('2026-11-02', now)).toBe(true);
    expect(isAroundToday('2026-10-27', now)).toBe(false);
    expect(isAroundToday(null, now)).toBe(true);
  });
});
