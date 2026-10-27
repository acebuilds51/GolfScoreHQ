import { describe, expect, it } from 'vitest';
import { OCBC_STYLE_FORM, rulesFromForm } from '../src/lib/scoring';
import { settleWeek } from '../src/lib/settlement';
import { buildStandings, sortStandings } from '../src/lib/standings';
import type { Layout, LeagueEvent, Player, RoundData, Season } from '../src/lib/types';

const front: Layout = { id: 'f', name: 'Front 9', tees: null, rating: null, slope: null, holes: [4, 3, 5, 4, 3, 4, 4, 4, 4].map((par, i) => ({ number: i + 1, par })) };
const PAR = front.holes.map((h) => h.par);
const season: Season = { id: 's', leagueId: 'l', year: 2027, name: '', rules: rulesFromForm(OCBC_STYLE_FORM), startDate: null, leagueDay: 4 };
const players: Player[] = ['al', 'ann', 'bob', 'bea'].map((id) => ({ id, displayName: id[0]!.toUpperCase() + id.slice(1), isSub: id === 'bea', active: true, userId: null, handicapIndex: null, ghinNumber: null, handicapIndexUpdatedAt: null }));

function round(id: string, eventId: string, overrides: Record<string, Record<number, number>>): RoundData {
  const ids = ['al', 'ann', 'bob', 'bea'];
  return {
    id, eventId, teeSlot: 1, status: 'submitted', currentHole: 8, submittedAt: 'x', presses: [], ctp: {},
    players: ids.map((p, i) => ({ playerId: p, side: i < 2 ? 'A' : 'B', position: i })),
    scores: Object.fromEntries(ids.map((p) => [p, Object.fromEntries(front.holes.map((h, i) => [h.number, overrides[p]?.[h.number] ?? PAR[i]!]))])),
  };
}

const ev = (id: string, week: number, status: LeagueEvent['status']): LeagueEvent => ({ id, seasonId: 's', weekNumber: week, eventDate: null, layoutId: 'f', status });

describe('season standings', () => {
  // Week 1: Al birdies 1 (A wins). Week 2: Bob birdies 2 (B wins). Week 3 is still open and doesn't count.
  const r1 = round('r1', 'e1', { al: { 1: 3 } });
  const r2 = round('r2', 'e2', { bob: { 2: 2 } });
  const r3 = round('r3', 'e3', { al: { 1: 9 } });
  const ledger = [
    ...settleWeek([r1], front, season.rules).entries.map((e) => ({ ...e, eventId: 'e1' })),
    ...settleWeek([r2], front, season.rules).entries.map((e) => ({ ...e, eventId: 'e2' })),
  ];
  const s = buildStandings({ season, events: [ev('e1', 1, 'settled'), ev('e2', 2, 'settled'), ev('e3', 3, 'scheduled')], rounds: [r1, r2, r3], ledger, layouts: [front], players });
  const row = (id: string) => s.rows.find((r) => r.playerId === id)!;

  it('counts only settled weeks', () => {
    expect(s.weeksCounted).toBe(2);
    expect(row('al').rounds).toBe(2);
    expect(row('al').weeks.map((w) => w.score)).toEqual([34, 35]);
  });

  it('tracks averages, records, skins and money', () => {
    expect(row('al')).toMatchObject({ average: 34.5, averageToPar: -0.5, best: { week: 1, score: 34, toPar: -1 }, wins: 1, losses: 1, skins: 1, money: 500 + 18000 - 500 });
    expect(row('bob')).toMatchObject({ wins: 1, losses: 1, skins: 1, money: -500 + 500 + 18000 });
    expect(row('bea').isSub).toBe(true);
  });

  it('sorts by the chosen column', () => {
    expect(sortStandings(s.rows, 'average').map((r) => r.playerId).slice(0, 2).sort()).toEqual(['al', 'bob']);
    expect(sortStandings(s.rows, 'money')[0]!.money).toBe(18000);
    expect(sortStandings(s.rows, 'skins').slice(0, 2).map((r) => r.skins)).toEqual([1, 1]);
  });

  it('hands out awards', () => {
    expect(s.awards.find((a) => a.key === 'mostSkins')!.winners.sort()).toEqual(['al', 'bob']);
  });
});
