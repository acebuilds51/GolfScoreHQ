import { describe, expect, it } from 'vitest';
import { OCBC_BEST_BALL, scoreMatch, totalsByPlayer } from '../src';
import { parRound, round } from './fixtures';

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe('best-ball match', () => {
  it('pays $5 a man to the side that wins more holes', () => {
    const r = round('r1', 3, { A: ['al', 'ann'], B: ['bob', 'bea'] }, {
      al: parRound({ 0: 3, 3: 3 }), // birdies on 1 and 4
      ann: parRound({ 6: 3 }), //      birdie on 7
      bob: parRound({ 8: 3 }), //      birdie on 9
      bea: parRound(),
    });
    const m = scoreMatch(r, 9, OCBC_BEST_BALL);
    expect(m.holesWon).toEqual({ A: 3, B: 1 });
    expect(m.winner).toBe('A');
    expect(totalsByPlayer(m.ledger)).toEqual({ al: 500, ann: 500, bob: -500, bea: -500 });
  });

  it('pays nothing on a halved match', () => {
    const r = round('r1', 1, { A: ['al', 'ann'], B: ['bob', 'bea'] }, {
      al: parRound({ 0: 3 }), ann: parRound(), bob: parRound({ 1: 2 }), bea: parRound(),
    });
    const m = scoreMatch(r, 9, OCBC_BEST_BALL);
    expect(m.winner).toBeNull();
    expect(m.ledger).toEqual([]);
  });

  it('settles a press over the holes from where it was called', () => {
    // A wins holes 1-3, B wins holes 6-8 after pressing on hole 6.
    const r = round('r1', 2, { A: ['al', 'ann'], B: ['bob', 'bea'] }, {
      al: parRound({ 0: 3, 1: 2, 2: 4 }),
      ann: parRound(),
      bob: parRound({ 5: 3, 6: 3, 7: 3 }),
      bea: parRound(),
    }, { presses: [{ startHoleIndex: 5, calledBy: 'B' }] });
    const m = scoreMatch(r, 9, OCBC_BEST_BALL);
    expect(m.winner).toBeNull(); // 3-3 overall
    expect(m.presses[0]).toMatchObject({ holesWon: { A: 0, B: 3 }, winner: 'B' });
    expect(totalsByPlayer(m.ledger)).toEqual({ bob: 1000, bea: 1000, al: -1000, ann: -1000 });
  });

  it('keeps a 2-vs-1 match zero-sum: the lone player covers both opponents', () => {
    // Legacy bug: with 3 players, press money was credited to an undefined 4th player.
    const r = round('r1', 4, { A: ['al', 'ann'], B: ['bob'] }, {
      al: parRound({ 0: 3, 5: 3 }), ann: parRound(), bob: parRound(),
    }, { presses: [{ startHoleIndex: 4, calledBy: 'B' }] });
    const m = scoreMatch(r, 9, OCBC_BEST_BALL);
    expect(totalsByPlayer(m.ledger)).toEqual({ al: 1500, ann: 1500, bob: -3000 });
    expect(sum(m.ledger.map((e) => e.amount))).toBe(0);
  });

  it('has no match when only one side played', () => {
    const r = round('r1', 5, { A: ['al'], B: [] }, { al: parRound() });
    const m = scoreMatch(r, 9, OCBC_BEST_BALL);
    expect(m.winner).toBeNull();
    expect(m.holeWinners.every((w) => w === null)).toBe(true);
    expect(m.ledger).toEqual([]);
  });

  it('gives a hole to the side that recorded a score when the other did not', () => {
    const bob = parRound();
    const bea: (number | null)[] = parRound();
    bob[2] = null as unknown as number;
    bea[2] = null;
    const r = round('r1', 6, { A: ['al', 'ann'], B: ['bob', 'bea'] }, {
      al: parRound(), ann: parRound(), bob, bea,
    });
    expect(scoreMatch(r, 9, OCBC_BEST_BALL).holeWinners[2]).toBe('A');
  });

  it('ignores presses when the league turns them off', () => {
    const r = round('r1', 2, { A: ['al', 'ann'], B: ['bob', 'bea'] }, {
      al: parRound(), ann: parRound(), bob: parRound({ 8: 3 }), bea: parRound(),
    }, { presses: [{ startHoleIndex: 7, calledBy: 'A' }] });
    const m = scoreMatch(r, 9, { ...OCBC_BEST_BALL, presses: { enabled: false, stake: 1000 } });
    expect(m.presses).toEqual([]);
    expect(totalsByPlayer(m.ledger)).toEqual({ bob: 500, bea: 500, al: -500, ann: -500 });
  });
});
