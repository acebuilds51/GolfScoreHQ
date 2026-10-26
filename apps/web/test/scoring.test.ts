import { describe, expect, it } from 'vitest';
import { basicRules, currentMarker, holesCompleted, layoutForWeek, matchSoFar, nextDate, OCBC_STYLE_FORM, rulesFromForm, toEngineRound } from '../src/lib/scoring';
import type { Course, Layout, RoundData } from '../src/lib/types';

const back: Layout = { id: 'back', name: 'Back 9', tees: null, rating: null, slope: null, holes: [4, 4, 3, 5, 3, 4, 3, 5, 4].map((par, i) => ({ number: i + 10, par })) };
const front: Layout = { ...back, id: 'front', name: 'Front 9', holes: [4, 3, 5, 4, 3, 4, 4, 4, 4].map((par, i) => ({ number: i + 1, par })) };

function round(id: string, teeSlot: number, scores: Record<string, number[]>, extra: Partial<RoundData> = {}): RoundData {
  const ids = Object.keys(scores);
  return {
    id, eventId: 'e', teeSlot, status: 'live', currentHole: 0, submittedAt: null, presses: [], ctp: {},
    players: ids.map((p, i) => ({ playerId: p, side: i < 2 ? 'A' : i < 4 ? 'B' : null, position: i })),
    scores: Object.fromEntries(ids.map((p) => [p, Object.fromEntries(scores[p]!.map((s, i) => [back.holes[i]!.number, s]))])),
    ...extra,
  };
}

describe('scoring helpers', () => {
  it('builds OCBC-style rules from the season form, in cents', () => {
    expect(rulesFromForm(OCBC_STYLE_FORM)).toMatchObject({ match: { stake: 500 }, presses: { enabled: true, stake: 1000 }, skins: { pot: 18000, payout: 'splitPot' }, ctp: { amountPerHole: 3600, resolution: 'markerChain' } });
    expect(rulesFromForm({ ...OCBC_STYLE_FORM, skinsTieRule: 'carryover' }).skins.payout).toBe('perHole');
  });

  it('counts holes completed by every player and reports the match so far', () => {
    const r = round('r1', 1, { al: [3, 4, 3], ann: [4, 4, 3], bob: [4, 4, 3], bea: [4, 3] });
    expect(holesCompleted(r, back)).toBe(2);
    expect(matchSoFar(r, back, basicRules()).label).toBe('All square thru 2'); // A won 10, B won 11
  });

  it('maps hole numbers (10–18) to the engine and presses to hole positions', () => {
    const r = round('r1', 1, { al: [4, 4, 3, 5, 3, 4, 3, 5, 4] }, { presses: [{ id: 'p', startHole: 13, calledBy: 'A' }] });
    const e = toEngineRound(r, back);
    expect(e.scores.al).toEqual([4, 4, 3, 5, 3, 4, 3, 5, 4]);
    expect(e.presses).toEqual([{ startHoleIndex: 3, calledBy: 'A' }]);
  });

  it('finds the current CTP marker from the chain of claims', () => {
    const r1 = round('r1', 1, { al: [] }, { ctp: { 12: { playerId: 'al', beat: null } } });
    const r2 = round('r2', 2, { bob: [] }, { ctp: { 12: { playerId: 'bob', beat: 'al' } } });
    const r3 = round('r3', 3, { cy: [] }, { ctp: { 12: { playerId: null, beat: null } } });
    expect(currentMarker([r2, r3, r1], back, 12)).toEqual({ holder: 'bob', disputed: false });
    expect(currentMarker([], back, 12)).toEqual({ holder: null, disputed: false });
  });

  it('alternates front and back nines by week and spaces dates a week apart', () => {
    const courses: Course[] = [{ id: 'c', name: 'Home', city: null, state: null, leagueId: 'l', layouts: [front, back] }];
    expect([1, 2, 3].map((w) => layoutForWeek(courses, w))).toEqual(['front', 'back', 'front']);
    expect(nextDate('2027-04-29', 1)).toBe('2027-04-29');
    expect(nextDate('2027-04-29', 3)).toBe('2027-05-13');
  });
});
