import { describe, expect, it } from 'vitest';
import { OCBC_STYLE_FORM, rulesFromForm, basicRules } from '../src/lib/scoring';
import { settleWeek, totalsFromLedger } from '../src/lib/settlement';
import type { Layout, RoundData } from '../src/lib/types';

const front: Layout = { id: 'f', name: 'Front 9', tees: null, rating: null, slope: null, holes: [4, 3, 5, 4, 3, 4, 4, 4, 4].map((par, i) => ({ number: i + 1, par })) };
const PAR = front.holes.map((h) => h.par);
const rules = rulesFromForm(OCBC_STYLE_FORM); // $5 match, $10 press, $180 skins, $36 CTP

function round(id: string, teeSlot: number, sides: { A: string[]; B: string[]; X?: string[] }, scores: Record<string, Record<number, number>>, extra: Partial<RoundData> = {}): RoundData {
  const players = [...sides.A.map((p) => ({ p, side: 'A' as const })), ...sides.B.map((p) => ({ p, side: 'B' as const })), ...(sides.X ?? []).map((p) => ({ p, side: null }))];
  return {
    id, eventId: 'e', teeSlot, status: 'submitted', currentHole: 8, submittedAt: 'x', presses: [], ctp: {},
    players: players.map(({ p, side }, i) => ({ playerId: p, side, position: i })),
    scores: Object.fromEntries(players.map(({ p }) => [p, Object.fromEntries(front.holes.map((h, i) => [h.number, scores[p]?.[h.number] ?? PAR[i]!]))])),
    ...extra,
  };
}

describe('settling a week', () => {
  // Group 1: Al birdies 1 (A wins 1-0). Group 2: skins-only Pete eagles 5.
  const r1 = round('r1', 1, { A: ['al', 'ann'], B: ['bob', 'bea'] }, { al: { 1: 3 } }, { ctp: { 2: { playerId: 'ann', beat: null }, 5: { playerId: null, beat: null } } });
  const r2 = round('r2', 2, { A: ['cy', 'cal'], B: ['dee', 'dan'], X: ['pete'] }, { pete: { 5: 1 } }, { ctp: { 2: { playerId: 'dee', beat: 'ann' }, 5: { playerId: 'pete', beat: null } } });

  it('pays matches, skins across every group and CTP by the marker chain', () => {
    const s = settleWeek([r1, r2], front, rules);
    expect(s.skins.map((k) => [k.holeNumber, k.playerId, k.value])).toEqual([[1, 'al', 9000], [5, 'pete', 9000]]);
    expect(s.ctp.map((c) => [c.holeNumber, c.winner])).toEqual([[2, 'dee'], [5, 'pete']]);
    const t = Object.fromEntries(s.totals.map((x) => [x.playerId, x.total]));
    expect(t).toMatchObject({ al: 500 + 9000, ann: 500, bob: -500, bea: -500, dee: 3600, pete: 9000 + 3600 });
    expect(s.unsubmitted).toBe(0);
    // Saved rows rebuild the same totals for everyone else's view
    expect(totalsFromLedger(s.entries)).toEqual(s.totals);
  });

  it('holds back a disputed CTP until the commissioner decides', () => {
    const r3 = round('r3', 3, { A: ['eve'], B: ['fay'] }, {}, { status: 'live', ctp: { 2: { playerId: 'eve', beat: 'ann' } } });
    const open = settleWeek([r1, r2, r3], front, rules);
    expect(open.ctp[0]).toMatchObject({ holeNumber: 2, winner: null, disputed: true });
    expect(open.ctp[0]!.contenders.sort()).toEqual(['dee', 'eve']);
    expect(open.entries.some((e) => e.kind === 'ctp' && e.holeNumber === 2)).toBe(false);
    expect(open.unsubmitted).toBe(1);

    const decided = settleWeek([r1, r2, r3], front, rules, { 2: 'eve' });
    expect(decided.ctp[0]).toMatchObject({ winner: 'eve', decided: true, disputed: false });
    expect(decided.entries.find((e) => e.kind === 'ctp' && e.holeNumber === 2)).toMatchObject({ playerId: 'eve', roundId: 'r3', amountCents: 3600 });
  });

  it('settles a Free league with no money at all', () => {
    expect(settleWeek([r1, r2], front, basicRules()).entries).toEqual([]);
  });
});
