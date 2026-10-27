import { describe, expect, it } from 'vitest';
import { guessColumns, isOcbcExport, matchRoster, parseTable, planFromOcbc, planFromTable, planSummary } from '../src/lib/importer';
import { toIsoDate } from '../src/lib/importRunner';
import type { Layout } from '../src/lib/types';

const front: Layout = { id: 'f', name: 'Front 9', tees: null, rating: null, slope: null, holes: [4, 3, 5, 4, 3, 4, 4, 4, 4].map((par, i) => ({ number: i + 1, par })) };
const back: Layout = { id: 'b', name: 'Back 9', tees: null, rating: null, slope: null, holes: [4, 4, 3, 5, 3, 4, 3, 5, 4].map((par, i) => ({ number: i + 10, par })) };
const layouts = [front, back];

describe('reading a pasted or CSV sheet', () => {
  it('reads tab-separated cells copied from a spreadsheet', () => {
    expect(parseTable('Week\tGolfer\t1\n1\tAl Adams\t4\n')).toEqual([['Week', 'Golfer', '1'], ['1', 'Al Adams', '4']]);
  });

  it('reads CSV with quotes, commas inside names and blank lines', () => {
    expect(parseTable('﻿Name,Week\r\n"Adams, Al",1\r\n\r\n"Bob ""BJ"" Banks",2')).toEqual([['Name', 'Week'], ['Adams, Al', '1'], ['Bob "BJ" Banks', '2']]);
  });

  it('guesses what each column is', () => {
    expect(guessColumns(['Wk', 'Date', 'Player Name', 'Tee Time', 'Team', 'H1', 'Hole 2', '3', 'Total', 'Notes'])).toEqual([
      'week', 'date', 'golfer', 'tee', 'team', 'hole:1', 'hole:2', 'hole:3', 'total', 'ignore',
    ]);
  });
});

describe('planning from a sheet', () => {
  const sheet = parseTable([
    'Week\tNine\tTee\tTeam\tGolfer\t1\t2\t3\t4\t5\t6\t7\t8\t9\tTotal',
    '1\tFront\t1\tA\tAl Adams\t4\t3\t5\t4\t3\t4\t4\t4\t4\t35',
    '1\tFront\t1\tB\tBob Banks\t5\t3\t5\t4\t3\t4\t4\t4\t4\t36',
    '2\tBack\t1\t\tAl Adams\t4\t4\t3\t5\t3\t4\t3\t5\t4\t35',
    '2\tBack\t2\t\tCy Cole\t\t\t\t\t\t\t\t\t\t41',
  ].join('\n'));
  const plan = planFromTable(sheet.slice(1), guessColumns(sheet[0]!), layouts, 'f');

  it('builds weeks and groups, putting back-nine scores on holes 10–18', () => {
    expect(planSummary(plan)).toEqual({ weeks: 2, groups: 2, rounds: 3 });
    expect(plan.weeks[0]).toMatchObject({ week: 1, layoutId: 'f' });
    expect(plan.weeks[0]!.groups[0]!.players.map((p) => [p.name, p.side, p.scores[1]])).toEqual([['Al Adams', 'A', 4], ['Bob Banks', 'B', 5]]);
    expect(plan.weeks[1]).toMatchObject({ week: 2, layoutId: 'b' });
    expect(Object.keys(plan.weeks[1]!.groups[0]!.players[0]!.scores).map(Number)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });

  it('skips rows with only a total and says so', () => {
    expect(plan.names).toEqual(['Al Adams', 'Bob Banks']);
    expect(plan.problems).toEqual(['1 row has no hole scores and was skipped.']);
  });

  it('numbers weeks by date when there is no week column, and groups in fours', () => {
    const t = parseTable('Date,Golfer,1,2\n5/14/2026,A,4,3\n5/7/2026,B,4,3\n5/7/2026,C,5,3');
    const p = planFromTable(t.slice(1), guessColumns(t[0]!), layouts, 'f');
    expect(p.weeks.map((w) => [w.week, w.date, w.groups[0]!.players.map((x) => x.name)])).toEqual([[1, '5/7/2026', ['B', 'C']], [2, '5/14/2026', ['A']]]);
  });

  it('tells you what is missing', () => {
    expect(planFromTable([], ['week', 'golfer'], layouts, 'f').problems[0]).toMatch(/hole-by-hole/);
  });
});

describe('the old OCBC export', () => {
  const round = (week: number, side: 'front' | 'back', teeTime: number, names: string[], ctpWinners: Record<string, string> = {}, extra = {}) => ({
    week, side, teeTime, players: names.map((name) => ({ name })),
    scores: Array.from({ length: 9 }, () => Object.fromEntries(names.map((_, i) => [`p${i}`, 4]))),
    presses: [{ startHole: side === 'front' ? 5 : 14, calledBy: 'B' }], ctpWinners, awins: 0, bwins: 0, matchWinner: null, ...extra,
  });
  const exp = JSON.stringify([
    round(1, 'front', 1, ['Al', 'Ann', 'Bob', 'Bea'], { 2: 'Al' }),
    round(1, 'front', 2, ['Cy', 'Cal', 'Dee', 'Dot', 'Pete'], { 2: 'Dee', 5: '__none__' }),
    round(2, 'back', 1, ['Al', 'Ann', 'Bob', 'Bea']),
    { ...round(3, 'front', 1, ['Al', 'Ann', 'Bob', 'Bea']), isScramble: true },
  ]);

  it('recognizes the export, including what the Google Sheet script returns', () => {
    expect(isOcbcExport(exp)).toBe(true);
    const fromSheet = JSON.stringify({ ok: true, rounds: JSON.parse(exp), config: {} });
    expect(isOcbcExport(fromSheet)).toBe(true);
    expect(planSummary(planFromOcbc(fromSheet, layouts)).weeks).toBe(2);
    expect(isOcbcExport('Week,Golfer\n1,Al')).toBe(false);
    expect(isOcbcExport(JSON.stringify({ ok: false, error: 'bad' }))).toBe(false);
  });

  it('keeps teams, presses and the latest tee time\'s CTP, and leaves out scramble rounds', () => {
    const p = planFromOcbc(exp, layouts);
    expect(planSummary(p)).toEqual({ weeks: 2, groups: 3, rounds: 13 });
    const [g1, g2] = p.weeks[0]!.groups;
    expect(g2!.players.map((x) => x.side)).toEqual(['A', 'A', 'B', 'B', null]); // Pete plays skins only
    expect(g1!.presses).toEqual([{ startHole: 5, calledBy: 'B' }]);
    expect(g1!.ctp).toEqual({ 2: null }); // Dee's later group took hole 2
    expect(g2!.ctp).toEqual({ 2: 'Dee', 5: null });
    expect(p.weeks[1]!.layoutId).toBe('b');
    expect(p.problems[0]).toMatch(/1 scramble round left out/);
  });
});

describe('matching the roster and dates', () => {
  it('matches names ignoring case and extra spaces', () => {
    expect(matchRoster(['al  adams', 'New Guy'], [{ id: '1', displayName: 'Al Adams' }])).toEqual({ matched: { 'al  adams': '1' }, missing: ['New Guy'] });
  });

  it('reads common date formats', () => {
    expect([toIsoDate('2026-5-7'), toIsoDate('5/7/26'), toIsoDate('May 7, 2026'), toIsoDate('soon')]).toEqual(['2026-05-07', '2026-05-07', '2026-05-07', null]);
  });
});
