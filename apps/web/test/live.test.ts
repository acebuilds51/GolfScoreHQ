import { describe, expect, it } from 'vitest';
import { liveBoard } from '../src/lib/live';
import { OCBC_STYLE_FORM, rulesFromForm } from '../src/lib/scoring';
import type { Layout, RoundData } from '../src/lib/types';

const front: Layout = { id: 'f', name: 'Front 9', tees: null, rating: null, slope: null, holes: [4, 3, 5, 4, 3, 4, 4, 4, 4].map((par, i) => ({ number: i + 1, par })) };
const rules = rulesFromForm(OCBC_STYLE_FORM);

function round(id: string, teeSlot: number, scores: Record<string, number[]>, extra: Partial<RoundData> = {}): RoundData {
  const ids = Object.keys(scores);
  return {
    id, eventId: 'e', teeSlot, status: 'live', currentHole: 0, submittedAt: null, presses: [], ctp: {},
    players: ids.map((p, i) => ({ playerId: p, side: i < 2 ? 'A' : i < 4 ? 'B' : null, position: i })),
    scores: Object.fromEntries(ids.map((p) => [p, Object.fromEntries(scores[p]!.map((s, i) => [i + 1, s]))])),
    ...extra,
  };
}

describe('live leaderboard', () => {
  // Group 1 has finished 3 holes; group 2 has finished 2.
  const g1 = round('g1', 1, { al: [3, 3, 5], ann: [4, 3, 6], bob: [4, 2, 5], bea: [5, 3, 5] }, { ctp: { 2: { playerId: 'bob', beat: null } } });
  // Group 2: Cy vs Dee, with Pete playing for skins only.
  const g2 = round('g2', 2, { cy: [4, 3], dee: [3, 3], pete: [4, 1] }, {
    ctp: { 2: { playerId: 'pete', beat: 'bob' } },
    players: [{ playerId: 'cy', side: 'A', position: 0 }, { playerId: 'dee', side: 'B', position: 1 }, { playerId: 'pete', side: null, position: 2 }],
  });
  const board = liveBoard([g1, g2], front, rules);

  it('ranks every golfer by score to par, then holes played', () => {
    expect(board.lines.map((l) => [l.playerId, l.toPar, l.thru])).toEqual([
      ['pete', -2, 2], ['al', -1, 3], ['bob', -1, 3], ['dee', -1, 2], ['cy', 0, 2], ['ann', 1, 3], ['bea', 1, 3],
    ]);
  });

  it('shows who is leading each skin so far, and ties', () => {
    expect(board.skins.slice(0, 4).map((s) => [s.holeNumber, s.playerId, s.score, s.tiedCount])).toEqual([
      [1, null, 3, 2], // al and dee tied with 3
      [2, 'pete', 1, 1], // hole-in-one
      [3, null, 5, 3], // al, bob, bea tied on 5
      [4, null, null, 0], // nobody there yet
    ]);
  });

  it('follows the CTP marker chain and collects birdies, eagles and aces', () => {
    expect(board.ctp.find((c) => c.holeNumber === 2)).toEqual({ holeNumber: 2, holder: 'pete', disputed: false });
    expect(board.highlights[0]).toEqual({ playerId: 'pete', holeNumber: 2, kind: 'ace' });
    expect(board.highlights.filter((h) => h.kind === 'birdie').map((h) => h.playerId).sort()).toEqual(['al', 'bob', 'dee']);
  });

  it('reports each group and how many are still out', () => {
    // Hole 1 to A (3 vs 4), hole 2 to B (Bob's 2), hole 3 halved (5 vs 5)
    // Group 2: Dee wins hole 1 (3 vs 4), hole 2 halved (3 vs 3); Pete's ace doesn't count in the match
    expect(board.matches.map((m) => [m.teeSlot, m.label, m.extra])).toEqual([[1, 'All square thru 3', []], [2, 'B 1 up thru 2', ['pete']]]);
    expect(board.groupsOnCourse).toBe(2);
  });
});
