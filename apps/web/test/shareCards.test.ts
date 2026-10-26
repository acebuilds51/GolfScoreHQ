import type { WeeklyRecap } from '@golfscorehq/engine';
import { describe, expect, it } from 'vitest';
import { resultsModel, winnerModel } from '../src/lib/shareCards';

const NAMES: Record<string, string> = { jim: 'Jim Jones', bill: 'Billy Bob', rick: 'Rick Smith', tig: 'Tiger Woods', al: 'Al Adams', bob: 'Bob Banks' };
const name = (id: string) => NAMES[id] ?? '?';

const recap: WeeklyRecap = {
  week: 4,
  layoutName: 'Front 9',
  matches: [
    { roundId: 'r1', teeSlot: 1, teamA: ['jim', 'bill'], teamB: ['rick', 'tig'], holesWon: { A: 5, B: 3 }, winner: 'A' },
    { roundId: 'r2', teeSlot: 2, teamA: ['al'], teamB: ['bob'], holesWon: { A: 2, B: 4 }, winner: 'B' },
    { roundId: 'r3', teeSlot: 3, teamA: ['al'], teamB: ['rick'], holesWon: { A: 3, B: 3 }, winner: null },
  ],
  skins: [
    { holeNumber: 1, playerIds: ['jim'], value: 2572 },
    { holeNumber: 2, playerIds: ['jim'], value: 2572 },
    { holeNumber: 7, playerIds: ['bill'], value: 2571 },
  ],
  ctp: [
    { holeNumber: 2, winner: 'jim', disputed: false },
    { holeNumber: 5, winner: null, disputed: false },
  ],
  highlights: [
    { playerId: 'jim', kind: 'birdie', holeNumber: 2 },
    { playerId: 'jim', kind: 'birdie', holeNumber: 5 },
    { playerId: 'bill', kind: 'birdie', holeNumber: 7 },
  ],
  lowRound: { playerIds: ['jim'], score: 34, toPar: -2 },
  weekBalances: {},
  seasonBalances: {},
};

describe('league results picture', () => {
  it('leaves money off by default', () => {
    const m = resultsModel(recap, name, { includeMoney: false, ctpCents: { 2: 3600 } });
    expect(m.lowRound).toEqual({ names: 'Jim Jones', score: 34, toPar: '2 under' });
    expect(m.matches).toEqual([
      { text: 'Jim & Billy def. Rick & Tiger', score: '5–3' },
      { text: 'Bob def. Al', score: '4–2' },
      { text: 'Al halved Rick', score: '3–3' },
    ]);
    expect(m.skins).toEqual([{ name: 'Jim Jones', count: 2, cents: null }, { name: 'Billy Bob', count: 1, cents: null }]);
    expect(m.ctp).toEqual([{ hole: 2, name: 'Jim Jones', cents: null }]); // nobody won hole 5
    expect(m.birdies).toBe(3);
    expect(JSON.stringify(m)).not.toMatch(/\$|2572|3600/);
  });

  it('shows amounts when the commissioner turns them on', () => {
    const m = resultsModel(recap, name, { includeMoney: true, ctpCents: { 2: 3600 } });
    expect(m.skins[0]).toEqual({ name: 'Jim Jones', count: 2, cents: 5144 });
    expect(m.ctp[0]!.cents).toBe(3600);
  });

  it('keeps a big week on one picture', () => {
    const many = { ...recap, matches: Array.from({ length: 8 }, (_, i) => ({ ...recap.matches[0]!, roundId: `r${i}` })) };
    const m = resultsModel(many, name, { includeMoney: false });
    expect(m.matches).toHaveLength(5);
    expect(m.moreMatches).toBe(3);
  });
});

describe('winner card', () => {
  it('shows only the stats the winner has', () => {
    expect(winnerModel(recap, name)).toEqual({
      label: 'Low round',
      name: 'Jim Jones',
      score: 34,
      toPar: '2 under',
      stats: [{ value: '2', label: 'Birdies' }, { value: '2', label: 'Skins' }, { value: '#2', label: 'CTP' }],
    });
    const quiet = { ...recap, lowRound: { playerIds: ['rick'], score: 36, toPar: 0 } };
    expect(winnerModel(quiet, name)!.stats).toEqual([]);
    expect(winnerModel(quiet, name)!.toPar).toBe('Even par');
  });

  it('names everyone tied for low', () => {
    const tied = { ...recap, lowRound: { playerIds: ['jim', 'bill'], score: 34, toPar: -2 } };
    expect(winnerModel(tied, name)).toMatchObject({ label: 'Low round (tied)', name: 'Jim Jones & Billy Bob' });
  });
});
