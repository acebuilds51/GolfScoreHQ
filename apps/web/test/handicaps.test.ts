import { describe, expect, it } from 'vitest';
import { courseHandicapFor, fmtIndex, leagueIndexes, leagueScoreRecords, parseIndex, ratingSlope, type PlayedRound } from '../src/lib/handicaps';
import type { Layout, Player, RoundData } from '../src/lib/types';

const PARS = [4, 3, 5, 4, 3, 4, 4, 4, 4]; // par 35
const nine: Layout = { id: 'f', name: 'Front 9', tees: null, rating: 35.0, slope: 113, holes: PARS.map((par, i) => ({ number: i + 1, par, strokeIndex: [5, 13, 1, 9, 17, 3, 11, 7, 15][i] })) };
const player = (id: string, handicapIndex: number | null = null): Player => ({ id, displayName: id, isSub: false, active: true, userId: null, handicapIndex, ghinNumber: null, handicapIndexUpdatedAt: null });
const roundOf = (id: string, scores: Record<string, number[]>): RoundData => ({
  id, eventId: 'e', teeSlot: 1, status: 'submitted', currentHole: 8, presses: [], ctp: {}, submittedAt: null,
  players: Object.keys(scores).map((p, i) => ({ playerId: p, side: i < 2 ? 'A' : 'B', position: i })),
  scores: Object.fromEntries(Object.entries(scores).map(([p, s]) => [p, Object.fromEntries(s.map((v, i) => [i + 1, v]))])),
});
const over = (n: number) => PARS.map((p, i) => p + (i < n ? 1 : 0)); // n bogeys

describe('course handicap', () => {
  it('uses the nine-hole formula on a nine and the full one on 18', () => {
    // Nine: 12.4/2 × 125/113 + (35.2 − 36) = 6.86 − 0.8 = 6.06 → 6
    expect(courseHandicapFor(12.4, { holes: [...PARS.slice(0, 8), 5].map((par, i) => ({ number: i + 1, par })), rating: 35.2, slope: 125 })).toBe(6);
    // 18: 10 × 113/113 + (72 − 72) = 10
    const eighteen = [...PARS, ...PARS].map((par, i) => ({ number: i + 1, par: i === 17 ? 6 : par }));
    expect(courseHandicapFor(10, { holes: eighteen, rating: 72, slope: 113 })).toBe(10);
  });

  it('treats a card with no rating or slope as an average course', () => {
    expect(ratingSlope({ holes: nine.holes, rating: null, slope: null })).toEqual({ rating: 35, slope: 113, par: 35, estimated: true });
    expect(courseHandicapFor(10, { holes: nine.holes, rating: null, slope: null })).toBe(5);
  });
});

describe('league index', () => {
  it('caps blow-up holes at par + 5 for golfers without an index, net double bogey with one', () => {
    const blowUp = [...PARS]; blowUp[2] = 12; // a 12 on the par 5
    const played: PlayedRound[] = [{ round: roundOf('r', { al: blowUp }), layout: nine }];
    expect(leagueScoreRecords('al', played, null)[0]!.score).toBe(35 - 5 + 10); // capped at 10
    // Index 18 → 9 strokes on the nine (one per hole): net double bogey = par + 3 → 8.
    expect(leagueScoreRecords('al', played, 18)[0]!.score).toBe(35 - 5 + 8);
  });

  it('needs 6 complete nines (3 eighteen-hole scores) before it gives an index', () => {
    const rounds = (n: number) => Array.from({ length: n }, (_, i): PlayedRound => ({ round: roundOf(`r${i}`, { al: over(4) }), layout: nine }));
    expect(leagueIndexes([player('al')], rounds(5), 'ghinFirst').get('al')).toMatchObject({ index: null, leagueIndex: null, leagueRounds: 5 });
    // Every nine is 39 on rating 35, slope 113: each 18-hole differential is 78 − 70 = 8.
    // With 3 differentials WHS uses the lowest one minus 2 → 6.0.
    expect(leagueIndexes([player('al')], rounds(6), 'ghinFirst').get('al')).toMatchObject({ index: 6, from: 'league', leagueIndex: 6, leagueRounds: 6 });
  });

  it('skips unfinished rounds', () => {
    const partial = roundOf('p', { al: over(0) });
    delete partial.scores.al![9];
    expect(leagueScoreRecords('al', [{ round: partial, layout: nine }], null)).toEqual([]);
  });

  it('picks GHIN or the league calculation per the league’s setting', () => {
    const played = Array.from({ length: 6 }, (_, i): PlayedRound => ({ round: roundOf(`r${i}`, { al: over(4), bo: over(4) }), layout: nine }));
    const people = [player('al', 12.4), player('bo')];
    expect(leagueIndexes(people, played, 'ghinFirst').get('al')).toMatchObject({ index: 12.4, from: 'ghin' });
    expect(leagueIndexes(people, played, 'ghinFirst').get('bo')).toMatchObject({ index: 6, from: 'league' });
    expect(leagueIndexes(people, played, 'ghin').get('bo')).toMatchObject({ index: null, from: null });
    expect(leagueIndexes(people, played, 'league').get('al')!.from).toBe('league');
  });
});

describe('entering an index', () => {
  it('reads plus handicaps and rejects nonsense', () => {
    expect(parseIndex('12.4')).toBe(12.4);
    expect(parseIndex('+1.2')).toBe(-1.2);
    expect(parseIndex(' ')).toBeNull();
    expect(parseIndex('60')).toBe('bad');
    expect(parseIndex('abc')).toBe('bad');
    expect(fmtIndex(-1.2)).toBe('+1.2');
    expect(fmtIndex(8)).toBe('8.0');
  });
});
