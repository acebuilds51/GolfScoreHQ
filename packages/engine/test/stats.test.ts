import { describe, expect, it } from 'vitest';
import {
  headToHead,
  OCBC_BEST_BALL,
  recapText,
  seasonAwards,
  seasonStats,
  settleBestBallWeek,
  weeklyRecap,
  withPostedResults,
  type PlayedRound,
} from '../src';
import { FRONT, parRound, round } from './fixtures';

// Week 1: Al birdies 1 and eagles 3, A wins 2-0. Week 2: Bob birdies 4, B wins 1-0.
const week1 = round('w1', 3, { A: ['al', 'ann'], B: ['bob', 'bea'] }, {
  al: parRound({ 0: 3, 2: 3 }), ann: parRound(), bob: parRound(), bea: parRound(),
});
const week2 = round('w2', 4, { A: ['al', 'ann'], B: ['bob', 'bea'] }, {
  al: parRound(), ann: parRound(), bob: parRound({ 3: 3 }), bea: parRound(),
});
const played: PlayedRound[] = [
  { week: 1, layout: FRONT, round: week1 },
  { week: 2, layout: FRONT, round: week2 },
];
const ledger1 = settleBestBallWeek([week1], FRONT, OCBC_BEST_BALL).ledger;
const ledger2 = settleBestBallWeek([week2], FRONT, OCBC_BEST_BALL).ledger;
const stats = seasonStats(played, [...ledger1, ...ledger2], OCBC_BEST_BALL);

describe('season stats', () => {
  it('tracks scoring to par, birdies, eagles, matches, skins and money', () => {
    expect(stats.al).toMatchObject({
      rounds: 2, averageToPar: -1.5, best: { week: 1, score: 32, toPar: -3 },
      birdies: 1, eagles: 1, matchWins: 1, matchLosses: 1, skins: 2, money: 500 + 18000 - 500,
    });
    expect(stats.bob).toMatchObject({ birdies: 1, skins: 1, matchWins: 1, matchLosses: 1, money: -500 + 500 + 18000 });
  });

  it('only averages rounds with every hole recorded', () => {
    const partial = round('w3', 1, { A: ['al'], B: ['bob'] }, { al: [4, 3, null, 4, 3, 4, 4, 4, 4], bob: parRound() });
    const s = seasonStats([...played, { week: 3, layout: FRONT, round: partial }], [], OCBC_BEST_BALL);
    expect(s.al!.rounds).toBe(2);
  });

  it('keeps head-to-head records between opponents', () => {
    expect(headToHead(played, OCBC_BEST_BALL)['al|bob']).toEqual({ playerA: 'al', playerB: 'bob', aWins: 1, bWins: 1, halves: 0 });
  });
});

describe('season awards', () => {
  const awards = seasonAwards(stats, { minRounds: 2, handicaps: { al: { start: 12, end: 9.5 }, bob: { start: 10, end: 10.4 } } });
  const award = (key: string) => awards.find((a) => a.key === key);

  it('names the leaders and shares ties', () => {
    expect(award('lowAverage')).toMatchObject({ winners: ['al'], value: -1.5 });
    expect(award('bestRound')).toMatchObject({ winners: ['al'], value: -3 });
    expect(award('mostSkins')).toMatchObject({ winners: ['al'], value: 2 });
    expect(award('birdieMachine')!.winners).toEqual(['al', 'bob']);
    expect(award('moneyLeader')).toMatchObject({ winners: ['al', 'bob'], value: 18000 });
    expect(award('eagleClub')!.winners).toEqual(['al']);
    expect(award('mostImproved')).toMatchObject({ winners: ['al'], value: 2.5 });
  });

  it('skips awards nobody earned', () => {
    expect(award('ctpKing')).toBeUndefined(); // no CTPs this season
    expect(award('aceClub')).toBeUndefined();
    expect(award('hotStreak')).toBeUndefined(); // nobody finished better than their average
  });
});

describe('weekly recap', () => {
  const recap = weeklyRecap(1, [week1], FRONT, OCBC_BEST_BALL);
  const name = (id: string) => id[0]!.toUpperCase() + id.slice(1);

  it('summarizes matches, skins, highlights, low round and balances', () => {
    expect(recap.matches).toEqual([{ roundId: 'w1', teeSlot: 3, teamA: ['al', 'ann'], teamB: ['bob', 'bea'], holesWon: { A: 2, B: 0 }, winner: 'A' }]);
    expect(recap.skins.map((s) => [s.holeNumber, s.playerIds[0], s.value])).toEqual([[1, 'al', 9000], [3, 'al', 9000]]);
    expect(recap.highlights).toEqual([
      { playerId: 'al', kind: 'eagle', holeNumber: 3 },
      { playerId: 'al', kind: 'birdie', holeNumber: 1 },
    ]);
    expect(recap.lowRound).toEqual({ playerIds: ['al'], score: 32, toPar: -3 });
    expect(recap.weekBalances.al).toBe(18500);
  });

  it('adds earlier weeks into the season balance', () => {
    const r2 = weeklyRecap(2, [week2], FRONT, OCBC_BEST_BALL, ledger1);
    expect(r2.weekBalances.bob).toBe(500 + 18000);
    expect(r2.seasonBalances.bob).toBe(-500 + 500 + 18000);
  });

  it('uses the posted results for CTP decisions and balances', () => {
    const posted = withPostedResults(recap, [{ playerId: 'bea', amount: 3600, kind: 'ctp', holeNumber: 2 }], [{ playerId: 'bea', amount: 3600, kind: 'ctp' }, { playerId: 'al', amount: -500, kind: 'match' }]);
    expect(posted.ctp.find((c) => c.holeNumber === 2)).toMatchObject({ winner: 'bea', disputed: false });
    expect(posted.weekBalances).toEqual({ bea: 3600 });
    expect(posted.seasonBalances).toEqual({ bea: 3600, al: -500 });
  });

  it('renders a plain-text recap, with or without dollar amounts', () => {
    const text = recapText(recap, name, { leagueName: 'Oak Creek' });
    expect(text).toContain('Oak Creek — Week 1 recap (Front 9)');
    expect(text).toContain('Al & Ann beat Bob & Bea (2–0)');
    expect(text).toContain('Hole 1: Al (+$90)');
    expect(text).toContain('Eagle — Al, hole 3');
    expect(text).toContain('LOW ROUND: Al — 32 (-3)');
    expect(recapText(recap, name, { hideMoney: true })).not.toContain('$');
  });
});
