import { describe, expect, it } from 'vitest';
import { cleanSlugInput, parseRoster, randomJoinCode, SLUG_RE, slugify } from '../src/lib/util';

describe('cleanSlugInput', () => {
  it('turns a pasted website into a league link', () => {
    expect(cleanSlugInput('https://shepherdshollow.com/')).toBe('shepherdshollow');
    expect(cleanSlugInput('www.shepherdshollow.com')).toBe('shepherdshollow');
    expect(cleanSlugInput('https://example.com/leagues/Thursday Men')).toBe('thursday-men');
    expect(cleanSlugInput('shepherds-hollow')).toBe('shepherds-hollow');
    expect(cleanSlugInput('Shepherds Hollow-')).toBe('shepherds-hollow');
  });
});

describe('slugify', () => {
  it('makes a valid web address from a league name', () => {
    expect(slugify("Oak Creek Men's League!")).toBe('oak-creek-mens-league');
    expect(slugify('  Café Golf — 2027 ')).toBe('cafe-golf-2027');
    expect(SLUG_RE.test(slugify('A very long league name that goes on and on and on forever'))).toBe(true);
  });
});

describe('randomJoinCode', () => {
  it('is 6 characters without look-alikes', () => {
    const code = randomJoinCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
});

describe('parseRoster', () => {
  it('reads names, emails, phones and subs from typed lines', () => {
    const r = parseRoster('Pat Jones, pat@Example.com, 248-555-0101\nChris Lee, sub\n\nSmith, John');
    expect(r.players).toEqual([
      { displayName: 'Pat Jones', isSub: false, email: 'pat@example.com', phone: '248-555-0101' },
      { displayName: 'Chris Lee', isSub: true },
      { displayName: 'John Smith', isSub: false },
    ]);
    expect(r.skipped).toEqual([]);
  });

  it('reads tab-separated rows pasted from a spreadsheet, skipping the header', () => {
    const r = parseRoster('Name\tEmail\tType\nPat\tJones\tpat@x.com\tRegular\nSam Lee\t\tSub');
    expect(r.players).toEqual([
      { displayName: 'Pat Jones', isSub: false, email: 'pat@x.com' },
      { displayName: 'Sam Lee', isSub: true },
    ]);
  });

  it('skips golfers already on the roster or repeated in the paste', () => {
    const r = parseRoster('pat jones\nAl Ray\nal ray', ['Pat Jones']);
    expect(r.players.map((p) => p.displayName)).toEqual(['Al Ray']);
    expect(r.skipped.map((s) => s.reason)).toEqual(['pat jones is already on the roster', 'al ray is listed twice']);
  });

  it('flags lines without a name', () => {
    expect(parseRoster('someone@example.com').skipped).toEqual([{ line: 'someone@example.com', reason: 'No name found' }]);
  });

  it('pulls an email and phone out of the name when only spaces separate them', () => {
    const r = parseRoster('Jim Jones jim@Example.com 248-555-1212\nAnn Lee (248) 555-0100 sub\nBo Fox, bo@x.com 248.555.0199');
    expect(r.players).toEqual([
      { displayName: 'Jim Jones', isSub: false, email: 'jim@example.com', phone: '248-555-1212' },
      { displayName: 'Ann Lee', isSub: true, phone: '(248) 555-0100' },
      { displayName: 'Bo Fox', isSub: false, email: 'bo@x.com', phone: '248.555.0199' },
    ]);
  });
});
