import { describe, expect, it } from 'vitest';
import { exportName, moneyCsv, scoresCsv, toCsv } from '../src/lib/exportSeason';
import type { SeasonData } from '../src/lib/seasonData';

// Only the fields the export reads.
const season = {
  season: { name: '2027' },
  layouts: [
    { id: 'front', name: 'Front 9', holes: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => ({ number, par: 4 })) },
    { id: 'back', name: 'Back 9', holes: [10, 11, 12, 13, 14, 15, 16, 17, 18].map((number) => ({ number, par: 4 })) },
  ],
  events: [
    { id: 'w1', weekNumber: 1, eventDate: '2027-04-07', layoutId: 'front', status: 'settled' },
    { id: 'w2', weekNumber: 2, eventDate: '2027-04-14', layoutId: 'back', status: 'scheduled' },
  ],
  players: [{ id: 'al', displayName: 'Al "Ace" Smith' }, { id: 'bo', displayName: '=Bo' }],
  rounds: [
    { eventId: 'w2', teeSlot: 1, players: [{ playerId: 'al', position: 0, courseHandicap: 8 }], scores: { al: { 10: 5, 11: 4 } } },
    { eventId: 'w1', teeSlot: 1, players: [{ playerId: 'bo', position: 1, courseHandicap: null }, { playerId: 'al', position: 0, courseHandicap: 8 }], scores: { al: { 1: 4, 2: 3 } } },
  ],
  ledger: [
    { eventId: 'w1', playerId: 'al', kind: 'skin', holeNumber: 2, amountCents: 1250 },
    { eventId: 'w2', playerId: 'bo', kind: 'skin', holeNumber: 10, amountCents: 900 },
  ],
} as unknown as SeasonData;

const lines = (csv: string) => csv.trimEnd().split('\r\n');

describe('season export', () => {
  it('quotes commas and quotes, and keeps formulas as text', () => {
    expect(toCsv([['a,b', 'say "hi"', '=SUM(A1)', -3, null]])).toBe('"a,b","say ""hi""",\'=SUM(A1),-3,\r\n');
  });

  it('puts each golfer’s card in week order, with back-nine scores under holes 10–18', () => {
    const [head, al1, bo1, al2] = lines(scoresCsv(season));
    expect(head).toBe('Week,Date,Course,Tee time,Golfer,Course handicap,' + Array.from({ length: 18 }, (_, i) => `Hole ${i + 1}`).join(',') + ',Total');
    expect(al1).toBe('1,2027-04-07,Front 9,1,"Al ""Ace"" Smith",8,4,3' + ','.repeat(16) + ',7');
    expect(bo1).toBe("1,2027-04-07,Front 9,1,'=Bo" + ','.repeat(20));
    expect(al2).toBe('2,2027-04-14,Back 9,1,"Al ""Ace"" Smith",8,' + ','.repeat(9) + '5,4' + ','.repeat(7) + ',9');
  });

  it('lists money for settled weeks only', () => {
    expect(lines(moneyCsv(season))).toEqual(['Week,Golfer,For,Hole,Amount ($)', '1,"Al ""Ace"" Smith",Skin,2,12.50']);
  });

  it('names files after the league and season', () => {
    expect(exportName('maple-wednesday', 'Summer 2027!', 'scores')).toBe('maple-wednesday-summer-2027-scores.csv');
  });
});
