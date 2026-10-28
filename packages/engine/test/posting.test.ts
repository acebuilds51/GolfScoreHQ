import { describe, expect, it } from 'vitest';
import { OCBC_BEST_BALL, settleBestBallWeek, totalsByPlayer, weekPosting } from '../src';
import { FRONT, parRound, round } from './fixtures';

const rules = { ...OCBC_BEST_BALL, ctp: { ...OCBC_BEST_BALL.ctp, resolution: 'markerChain' as const } };
const players = { al: parRound(), ann: parRound(), bob: parRound(), bea: parRound() };
const players2 = { cy: parRound({ 0: 3 }), cal: parRound(), dee: parRound(), dan: parRound() };
// Both groups say their player is closest on hole 2 with no marker to beat: a dispute.
const disputed = () => [
  round('r1', 1, { A: ['al', 'ann'], B: ['bob', 'bea'] }, players, { ctp: { 2: { winner: 'al', beat: null }, 5: 'none' } }),
  round('r2', 2, { A: ['cy', 'cal'], B: ['dee', 'dan'] }, players2, { ctp: { 2: { winner: 'dee', beat: null }, 5: 'none' } }),
];

describe('weekPosting (what the Settle button posts)', () => {
  it('is the engine week ledger when nothing is disputed', () => {
    const rounds = [round('r1', 1, { A: ['al', 'ann'], B: ['bob', 'bea'] }, players, { ctp: { 2: { winner: 'al', beat: null }, 5: 'none' } })];
    const p = weekPosting(rounds, FRONT, rules);
    expect(p.undecided).toEqual([]);
    expect(p.ledger).toEqual(settleBestBallWeek(rounds, FRONT, rules).ledger);
  });

  it('lists a disputed CTP hole as undecided and pays nobody for it', () => {
    const p = weekPosting(disputed(), FRONT, rules);
    expect(p.undecided).toEqual([2]);
    expect(p.ledger.some((e) => e.kind === 'ctp')).toBe(false);
  });

  it("pays the commissioner's pick on a disputed hole, in the winner's group", () => {
    const p = weekPosting(disputed(), FRONT, rules, { 2: 'dee' });
    expect(p.undecided).toEqual([]);
    expect(p.ledger.filter((e) => e.kind === 'ctp')).toEqual([{ playerId: 'dee', amount: 3600, kind: 'ctp', holeNumber: 2, roundId: 'r2' }]);
    expect(totalsByPlayer(p.ledger).dee).toBe(-500 + 3600);
  });

  it('ignores a pick who was not one of the contenders', () => {
    const p = weekPosting(disputed(), FRONT, rules, { 2: 'bob' });
    expect(p.undecided).toEqual([2]);
  });
});
