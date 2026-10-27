import { describe, expect, it } from 'vitest';
import {
  recapText, seasonStats, settleIndividualWeek, STANDARD_STABLEFORD, stablefordPoints, weeklyRecap,
  type MatchRoundInput, type StablefordRules, type StrokePlayRules,
} from '../src';
import { FRONT, parRound } from './fixtures';

const OFF = { enabled: false, tieRule: 'noSkin', payout: 'splitPot', pot: 0 } as const;
const NO_CTP = { enabled: false, amountPerHole: 0, resolution: 'markerChain' } as const;
const stroke = (extra: Partial<StrokePlayRules> = {}): StrokePlayRules => ({ format: 'strokePlay', payouts: [3000, 2000, 1000], skins: OFF, ctp: NO_CTP, ...extra });
const stableford = (extra: Partial<StablefordRules> = {}): StablefordRules => ({ format: 'stableford', points: STANDARD_STABLEFORD, payouts: [3000, 2000, 1000], skins: OFF, ctp: NO_CTP, ...extra });
const net = { enabled: true, allowance: 100, match: 'full', skins: 'gross' } as const;

/** A group with no sides: everyone plays their own ball. */
function group(id: string, teeSlot: number, scores: Record<string, (number | null)[]>, courseHandicaps?: Record<string, number>): MatchRoundInput {
  return { id, teeSlot, players: Object.keys(scores).map((p) => ({ id: p })), scores, ...(courseHandicaps ? { courseHandicaps } : {}) };
}

describe('Stableford points', () => {
  it('scores each hole against par', () => {
    expect([-3, -2, -1, 0, 1, 2, 5].map((d) => stablefordPoints(d, STANDARD_STABLEFORD))).toEqual([5, 4, 3, 2, 1, 0, 0]);
  });
});

describe('stroke play', () => {
  const unfinished = parRound();
  unfinished[8] = null as unknown as number;
  const rounds = [
    group('g1', 1, { al: parRound(), bob: parRound({ 0: 5 }) }),
    group('g2', 2, { cal: parRound(), dee: unfinished }),
  ];

  it('ranks finished rounds; ties share the places they cover', () => {
    const w = settleIndividualWeek(rounds, FRONT, stroke());
    expect(w.leaderboard.map((l) => [l.playerId, l.place, l.tied])).toEqual([['al', 1, true], ['cal', 1, true], ['bob', 3, false], ['dee', null, false]]);
    // al and cal split 1st + 2nd ($50); bob gets 3rd; dee didn't finish.
    expect(w.ledger).toEqual([
      { playerId: 'al', amount: 2500, kind: 'place', roundId: 'g1' },
      { playerId: 'cal', amount: 2500, kind: 'place', roundId: 'g2' },
      { playerId: 'bob', amount: 1000, kind: 'place', roundId: 'g1' },
    ]);
  });

  it('ranks on net with handicaps on', () => {
    const r = [group('g1', 1, { al: parRound(), bob: parRound({ 0: 5 }) }, { al: 0, bob: 2 })];
    const w = settleIndividualWeek(r, FRONT, stroke({ handicaps: net }));
    expect(w.leaderboard.map((l) => [l.playerId, l.toPar, l.grossToPar, l.place])).toEqual([['bob', -1, 1, 1], ['al', 0, 0, 2]]);
  });

  it('pays skins and places together', () => {
    const r = [group('g1', 1, { al: parRound({ 0: 3 }), bob: parRound() })];
    const w = settleIndividualWeek(r, FRONT, stroke({ payouts: [1000], skins: { enabled: true, tieRule: 'noSkin', payout: 'splitPot', pot: 500 } }));
    expect(w.ledger.map((e) => [e.playerId, e.kind, e.amount])).toEqual([['al', 'place', 1000], ['al', 'skin', 500]]);
  });
});

describe('Stableford', () => {
  // Al: birdie on 1, double on 2, pars after = 3 + 0 + 14 = 17. Bob: all pars = 18.
  const r = [group('g1', 1, { al: parRound({ 0: 3, 1: 5 }), bob: parRound() }, { al: 1, bob: 0 })];

  it('most points wins', () => {
    const w = settleIndividualWeek(r, FRONT, stableford());
    expect(w.leaderboard.map((l) => [l.playerId, l.points, l.place])).toEqual([['bob', 18, 1], ['al', 17, 2]]);
    expect(w.leaderboard[1]!.holePoints.slice(0, 3)).toEqual([3, 0, 2]);
  });

  it('net points use each golfer\'s strokes', () => {
    // Al's one stroke falls on hole 1 (no stroke index: hole order), turning his birdie into a net eagle.
    const w = settleIndividualWeek(r, FRONT, stableford({ handicaps: net }));
    expect(w.leaderboard.map((l) => [l.playerId, l.points, l.place, l.tied])).toEqual([['al', 18, 1, true], ['bob', 18, 1, true]]);
  });

  it('season stats count weekly wins and points', () => {
    const played = [1, 2].map((week) => ({ week, layout: FRONT, round: { ...r[0]!, id: `w${week}` } }));
    const s = seasonStats(played, [], stableford());
    expect([s.bob!.weekWins, s.bob!.points, s.bob!.averagePoints, s.al!.weekWins, s.al!.top3]).toEqual([2, 36, 18, 0, 2]);
  });

  it('the recap lists the finishing order', () => {
    const recap = weeklyRecap(3, r, FRONT, stableford());
    expect(recap.matches).toEqual([]);
    const text = recapText(recap, (id) => id.toUpperCase());
    expect(text).toContain('STABLEFORD\n  1. BOB — 18 pts (35)\n  2. AL — 17 pts (36)');
    expect(text).not.toContain('SKINS');
  });
});
