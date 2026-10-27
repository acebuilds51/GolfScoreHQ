import { describe, expect, it } from 'vitest';
import { matchStrokes, OCBC_BEST_BALL, playingHandicap, scoreMatch, settleBestBallWeek, strokesByHole, type BestBallMatchRules, type HandicapRules, type Layout } from '../src';
import { FRONT, parRound, round } from './fixtures';

// Front nine with odd stroke indexes, as a nine of an 18-hole card usually has.
const SI = [5, 13, 1, 9, 17, 3, 11, 7, 15];
const HOLES = FRONT.holes.map((h, i) => ({ ...h, strokeIndex: SI[i] }));
const LAYOUT: Layout = { ...FRONT, holes: HOLES };
const hcp = (h: Partial<HandicapRules>): BestBallMatchRules => ({
  ...OCBC_BEST_BALL,
  handicaps: { enabled: true, allowance: 100, match: 'offLow', skins: 'gross', ...h },
});

describe('handicap strokes', () => {
  it('applies the allowance with normal rounding', () => {
    expect(playingHandicap(12, 90)).toBe(11); // 10.8
    expect(playingHandicap(7, 85)).toBe(6); //   5.95
    expect(playingHandicap(10, 100)).toBe(10);
  });

  it('puts strokes on the hardest holes first, wrapping round past one per hole', () => {
    expect(strokesByHole(3, HOLES)).toEqual([1, 0, 1, 0, 0, 1, 0, 0, 0]); // SI 1, 3, 5
    expect(strokesByHole(10, HOLES)).toEqual([1, 1, 2, 1, 1, 1, 1, 1, 1]); // two on SI 1
    expect(strokesByHole(0, HOLES)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('gives strokes back on the easiest holes for a plus handicap', () => {
    expect(strokesByHole(-2, HOLES)).toEqual([0, 0, 0, 0, -1, 0, 0, 0, -1]); // SI 17 and 15
  });

  it('falls back to hole order when the card has no stroke index', () => {
    expect(strokesByHole(2, FRONT.holes)).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('net best-ball match', () => {
  // Everyone pars every hole: halved gross, but the B side gets strokes.
  const r = round('r1', 1, { A: ['al', 'ann'], B: ['bob', 'bea'] }, {
    al: parRound(), ann: parRound(), bob: parRound(), bea: parRound(),
  }, { courseHandicaps: { al: 4, ann: 10, bob: 16, bea: 20 } });

  it('plays off the low man: strokes are the difference from the lowest in the group', () => {
    expect(matchStrokes(r, hcp({}).handicaps)).toEqual({ al: 0, ann: 6, bob: 12, bea: 16 });
    // 90%: al 3.6→4, ann 9, bob 14.4→14, bea 18; then minus the low man's 4.
    expect(matchStrokes(r, hcp({ allowance: 90 }).handicaps)).toEqual({ al: 0, ann: 5, bob: 10, bea: 14 });
  });

  it('decides holes on net scores', () => {
    expect(scoreMatch(r, 9, OCBC_BEST_BALL, HOLES).holesWon).toEqual({ A: 0, B: 0 }); // handicaps off: gross
    const net = scoreMatch(r, 9, hcp({}), HOLES);
    expect(net.holesWon).toEqual({ A: 0, B: 9 });
    expect(net.winner).toBe('B');
    expect(scoreMatch(r, 9, hcp({ match: 'gross' }), HOLES).holesWon).toEqual({ A: 0, B: 0 });
  });

  it('treats a golfer with no handicap as scratch', () => {
    const noHcp = { ...r, courseHandicaps: { al: 4, ann: null, bob: 16, bea: 20 } };
    expect(matchStrokes(noHcp, hcp({ match: 'full' }).handicaps)).toEqual({ al: 4, ann: 0, bob: 16, bea: 20 });
  });
});

describe('net skins', () => {
  // Al (scratch) birdies hole 3 (SI 1); Bob gets a stroke there and pars it.
  const r = round('r1', 1, { A: ['al'], B: ['bob'] }, {
    al: parRound({ 2: 4 }),
    bob: parRound(),
  }, { courseHandicaps: { al: 0, bob: 1 } });

  it('Al wins the skin gross', () => {
    const w = settleBestBallWeek([r], LAYOUT, hcp({ skins: 'gross' }));
    expect(w.skins.wins.map((s) => [s.holeNumber, s.playerIds])).toEqual([[3, ['al']]]);
  });

  it('net, Bob\'s stroke ties it and nobody wins the skin', () => {
    const w = settleBestBallWeek([r], LAYOUT, hcp({ skins: 'net' }));
    expect(w.skins.wins).toEqual([]);
  });
});
