import { describe, expect, it } from 'vitest';
import { parseTable } from '../src/lib/importer';
import { cellsToTsv, cellText } from '../src/lib/sheetFile';

describe('Excel sheets for the importer', () => {
  it('turns cells into the same text as pasting them', () => {
    expect([cellText(null), cellText(4), cellText(4.5), cellText(1 / 3), cellText(new Date('2026-05-07T00:00:00Z')), cellText(' Al\tAdams\n')]).toEqual(
      ['', '4', '4.5', '0.333', '2026-05-07', 'Al Adams'],
    );
    const tsv = cellsToTsv([
      ['Week', 'Golfer', 1, 2, null],
      [null, null, null, null, null],
      [1, 'Al Adams', 4, 3, null],
    ]);
    expect(tsv).toBe('Week\tGolfer\t1\t2\n1\tAl Adams\t4\t3');
    expect(parseTable(tsv)).toEqual([['Week', 'Golfer', '1', '2'], ['1', 'Al Adams', '4', '3']]);
  });
});
