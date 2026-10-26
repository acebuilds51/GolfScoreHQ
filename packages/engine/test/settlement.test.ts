import { describe, expect, it } from 'vitest';
import {
  OCBC_BEST_BALL,
  OCBC_SCRAMBLE,
  settleBestBallWeek,
  settleCtp,
  settleScrambleWeek,
  settleSkins,
  splitEvenly,
  totalsByPlayer,
  type ScrambleRoundInput,
} from '../src';
import { FRONT, parRound, round } from './fixtures';

const HOLES = FRONT.holes.map((h) => h.number);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe('splitEvenly', () => {
  it('never loses a cent', () => {
    expect(splitEvenly(18000, 7)).toEqual([2572, 2572, 2572, 2571, 2571, 2571, 2571]);
    expect(sum(splitEvenly(13000, 9))).toBe(13000);
  });
});

describe('field skins (OCBC: ties mean no skin, pot split among skins won)', () => {
  const comp = (id: string, overrides: Record<number, number>) => ({ id, playerIds: [id], scores: parRound(overrides) });

  it('splits the $180 pot evenly across unique low scores', () => {
    const res = settleSkins(
      [comp('al', { 0: 3 }), comp('bob', { 3: 3 }), comp('cy', { 3: 3, 8: 3 })],
      HOLES,
      OCBC_BEST_BALL.skins,
    );
    // Hole 1: al alone. Hole 4: tie (bob, cy) = no skin. Hole 9: cy alone.
    expect(res.wins.map((w) => [w.holeNumber, w.competitorId, w.value])).toEqual([
      [1, 'al', 9000],
      [9, 'cy', 9000],
    ]);
    expect(totalsByPlayer(res.ledger)).toEqual({ al: 9000, cy: 9000 });
  });

  it('reports the whole pot as unawarded when every hole ties', () => {
    const res = settleSkins([comp('al', {}), comp('bob', {})], HOLES, OCBC_BEST_BALL.skins);
    expect(res.wins).toEqual([]);
    expect(res.unawarded).toBe(18000);
  });
});

describe('team skins with carryover (OCBC scramble)', () => {
  it('rolls a tied hole into the next one', () => {
    const teams = [
      { id: 't1', playerIds: ['a', 'b', 'c', 'd'], scores: parRound({ 0: 3, 1: 2 }) },
      { id: 't2', playerIds: ['e', 'f', 'g', 'h'], scores: parRound({ 0: 3 }) },
    ];
    const res = settleSkins(teams, HOLES, OCBC_SCRAMBLE.skins);
    // $130 / 9 holes: first 4 holes are worth 1445c, the rest 1444c.
    expect(res.wins).toHaveLength(1);
    expect(res.wins[0]).toMatchObject({ holeNumber: 2, competitorId: 't1', value: 1445 + 1445 });
    // Holes 3-9 all tie and carry off the end.
    expect(res.unawarded).toBe(13000 - 2890);
    expect(totalsByPlayer(res.ledger)).toEqual({ a: 723, b: 723, c: 722, d: 722 });
  });
});

describe('closest to the pin (latest tee slot that reports a winner)', () => {
  it('awards the par 3 to the latest group that claimed it', () => {
    const res = settleCtp(
      [
        { roundId: 'r3', teeSlot: 3, ctp: { 2: 'al', 5: 'al' } },
        { roundId: 'r7', teeSlot: 7, ctp: { 2: 'bob', 5: 'none' } },
        { roundId: 'r9', teeSlot: 9, ctp: { 2: 'none' } },
      ],
      [2, 5],
      OCBC_BEST_BALL.ctp,
    );
    expect(res.holes.map((h) => [h.holeNumber, h.winner])).toEqual([[2, 'bob'], [5, 'al']]);
    expect(totalsByPlayer(res.ledger)).toEqual({ bob: 3600, al: 3600 });
  });

  it('flags two groups at the same tee slot claiming different winners', () => {
    const res = settleCtp(
      [
        { roundId: 'x', teeSlot: 4, ctp: { 2: 'al' } },
        { roundId: 'y', teeSlot: 4, ctp: { 2: 'bob' } },
      ],
      [2],
      OCBC_BEST_BALL.ctp,
    );
    expect(res.holes[0]).toMatchObject({ winner: null, conflict: true });
    expect(res.ledger).toEqual([]);
  });
});

describe('closest to the pin (marker chain: "whose ball were you inside of?")', () => {
  const rules = { ...OCBC_BEST_BALL.ctp, resolution: 'markerChain' as const };
  const claim = (roundId: string, teeSlot: number, winner: string, beat: string | null) =>
    ({ roundId, teeSlot, ctp: { 2: { winner, beat } } });

  it('awards the claim nobody beat, whatever order groups report in', () => {
    const res = settleCtp(
      [
        claim('r6', 6, 'cy', 'bob'), //  reported first, played last
        { roundId: 'r2', teeSlot: 2, ctp: { 2: 'none' } },
        claim('r1', 1, 'al', null),
        claim('r3', 3, 'bob', 'al'),
      ],
      [2],
      rules,
    );
    expect(res.holes[0]).toMatchObject({ winner: 'cy', roundId: 'r6', conflict: false });
    expect(totalsByPlayer(res.ledger)).toEqual({ cy: 3600 });
  });

  it('ignores tee slots entirely (a later tee time can lose to an earlier one)', () => {
    const res = settleCtp([claim('r9', 9, 'dee', null), claim('r4', 4, 'eve', 'dee')], [2], rules);
    expect(res.holes[0]!.winner).toBe('eve');
  });

  it('flags two groups that both claim to be inside the same marker', () => {
    const res = settleCtp(
      [claim('r1', 1, 'al', null), claim('r3', 3, 'bob', 'al'), claim('r5', 5, 'cy', 'al')],
      [2],
      rules,
    );
    expect(res.holes[0]).toMatchObject({ winner: null, conflict: true });
    expect(res.holes[0]!.contenders.sort()).toEqual(['bob', 'cy']);
    expect(res.ledger).toEqual([]);
  });

  it('flags two separate "no marker yet" claims', () => {
    const res = settleCtp([claim('r1', 1, 'al', null), claim('r2', 2, 'bob', null)], [2], rules);
    expect(res.holes[0]).toMatchObject({ conflict: true });
  });

  it('still resolves when the group that set the beaten marker never reported', () => {
    const res = settleCtp([claim('r7', 7, 'cy', 'bob')], [2], rules);
    expect(res.holes[0]!.winner).toBe('cy');
  });
});

describe('a full OCBC week', () => {
  it('counts the skins-only "player 5" for skins (legacy bug: their scores were dropped)', () => {
    const r1 = round('r1', 1, { A: ['al', 'ann'], B: ['bob', 'bea'], skinsOnly: ['pete'] }, {
      al: parRound(), ann: parRound(), bob: parRound(), bea: parRound(), pete: parRound({ 4: 2 }),
    }, { ctp: { 2: 'none', 5: 'pete' } });
    const r2 = round('r2', 2, { A: ['cy', 'cal'], B: ['dee', 'dan'] }, {
      cy: parRound({ 0: 3 }), cal: parRound(), dee: parRound(), dan: parRound(),
    }, { ctp: { 2: 'dee', 5: 'none' } });

    const week = settleBestBallWeek([r1, r2], FRONT, OCBC_BEST_BALL);
    expect(week.skins.wins.map((w) => [w.holeNumber, w.playerIds[0]])).toEqual([[1, 'cy'], [5, 'pete']]);
    const totals = totalsByPlayer(week.ledger);
    expect(totals.pete).toBe(9000 + 3600); // skin + CTP on hole 5
    expect(totals.dee).toBe(-500 + 3600); //  lost the match, won CTP on hole 2
    expect(totals.cy).toBe(500 + 9000);
    // Matches net to zero; the only money in is the skins pot and the CTP payouts.
    expect(sum(Object.values(totals))).toBe(18000 + 3600 * 2);
  });
});

describe('scramble week', () => {
  const team = (id: string, teeSlot: number, total: Record<number, number>, players: string[]): ScrambleRoundInput => ({
    id, teeSlot, players, teamScores: parRound(total),
  });

  it('pays the team pot to the lowest total, split per player', () => {
    const res = settleScrambleWeek(
      [team('t1', 1, { 0: 3, 2: 4 }, ['a', 'b', 'c', 'd']), team('t2', 2, { 0: 3 }, ['e', 'f', 'g', 'h'])],
      FRONT,
      { ...OCBC_SCRAMBLE, skins: { ...OCBC_SCRAMBLE.skins, enabled: false } },
    );
    expect(res.winners.map((w) => w.roundId)).toEqual(['t1']);
    expect(totalsByPlayer(res.ledger)).toEqual({ a: 3000, b: 3000, c: 3000, d: 3000 });
  });

  it('splits the team pot between tied teams', () => {
    const res = settleScrambleWeek(
      [team('t1', 1, { 0: 3 }, ['a', 'b', 'c', 'd']), team('t2', 2, { 1: 2 }, ['e', 'f', 'g', 'h'])],
      FRONT,
      { ...OCBC_SCRAMBLE, skins: { ...OCBC_SCRAMBLE.skins, enabled: false } },
    );
    expect(res.winners).toHaveLength(2);
    expect(totalsByPlayer(res.ledger)).toMatchObject({ a: 1500, e: 1500 });
  });
});
