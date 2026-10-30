import { describe, expect, it } from 'vitest';
import { buildRecapEmail, splitMoney } from '../../../supabase/functions/send-recap/email';
import { cleanHandles, handleProblem, payoutNote, paypalPayUrl, venmoPayUrl, weekPayouts } from '../src/lib/payouts';
import type { LedgerRow } from '../src/lib/types';

// An OCBC-style week: Al and Bo beat Cy and Di ($5 a man) and won a press ($10 a man);
// Al won the skin on 3 and CTP on 7, Cy the skin on 8.
const row = (playerId: string, kind: LedgerRow['kind'], amountCents: number, holeNumber: number | null = null): LedgerRow =>
  ({ playerId, roundId: 'r1', kind, amountCents, holeNumber });
const week: LedgerRow[] = [
  row('al', 'match', 500), row('bo', 'match', 500), row('cy', 'match', -500), row('di', 'match', -500),
  row('al', 'press', 1000), row('bo', 'press', 1000), row('cy', 'press', -1000), row('di', 'press', -1000),
  row('al', 'skin', 9000, 3), row('cy', 'skin', 9000, 8), row('al', 'ctp', 3600, 7),
];

describe('paying out a week', () => {
  it('golfers settle the match: the commissioner pays skins and CTP only', () => {
    const p = weekPayouts(week, 'golfers');
    expect(p.map((x) => [x.playerId, x.cents, x.matchCents])).toEqual([['al', 12600, 1500], ['cy', 9000, -1500], ['bo', 0, 1500], ['di', 0, -1500]]);
    expect(p[0]).toMatchObject({ skinHoles: [3], ctpHoles: [7] });
  });

  it('match money through the commissioner: one net amount each way', () => {
    const p = weekPayouts(week, 'commissioner');
    expect(Object.fromEntries(p.map((x) => [x.playerId, x.cents]))).toEqual({ al: 14100, cy: 7500, bo: 1500, di: -1500 });
    expect(p.every((x) => x.matchCents === null)).toBe(true);
  });

  it('writes the note the commissioner sends with the payment', () => {
    const [al] = weekPayouts(week, 'golfers');
    expect(payoutNote('OCBC', 5, al!)).toBe('OCBC week 5: skin #3, CTP #7');
    expect(payoutNote('OCBC', 5, { ...al!, skinHoles: [3, 8], ctpHoles: [] })).toBe('OCBC week 5: skins #3 and #8');
  });

  it('opens Venmo and PayPal with the golfer, amount and note filled in', () => {
    expect(venmoPayUrl('@Joe-Smith', 12600, 'OCBC week 5: skin #3')).toBe('https://venmo.com/?txn=pay&audience=private&recipients=Joe-Smith&amount=126.00&note=OCBC+week+5%3A+skin+%233');
    expect(paypalPayUrl('joesmith', 3600)).toBe('https://paypal.me/joesmith/36.00USD');
    expect(venmoPayUrl(null, 100, 'x')).toBeNull();
  });

  it('tidies what golfers type for their handles', () => {
    expect(cleanHandles({ venmo: ' @Joe-Smith ', paypalMe: 'https://paypal.me/joesmith/10', zelle: '' })).toEqual({ venmo: 'Joe-Smith', paypalMe: 'joesmith', zelle: null });
    expect(cleanHandles({ venmo: 'https://venmo.com/u/Joe-Smith', paypalMe: null, zelle: ' joe@example.com ' })).toEqual({ venmo: 'Joe-Smith', paypalMe: null, zelle: 'joe@example.com' });
    expect(handleProblem({ venmo: 'joe smith', paypalMe: null, zelle: null })).toMatch(/Venmo/);
    expect(handleProblem({ venmo: 'Joe-Smith', paypalMe: 'joesmith', zelle: 'joe@example.com' })).toBeNull();
  });
});

describe('recap email money, OCBC style', () => {
  const base = { leagueName: 'OCBC', weekNumber: 5, leagueUrl: 'https://golfscorehq.app/l/ocbc', recapBody: 'WEEK', playerName: 'Cy Young', payment: { venmo: '@commish' } };
  const rows = week.map((e) => ({ playerId: e.playerId, kind: e.kind, amount: e.amountCents }));

  it('a skin winner who lost the match: what the commissioner owes, and the match result on its own; no pay-the-commissioner links', () => {
    const w = splitMoney(rows, 'cy', 'golfers');
    expect(w).toEqual({ commissioner: 9000, match: -1500 });
    const e = buildRecapEmail({ ...base, weekCents: w.commissioner, seasonCents: 20000, matchCents: w.match, seasonMatchCents: -2500 });
    expect(e.text).toContain('The commissioner owes you $90 this week. You lost $15 on your match and presses. Season to date: +$200 from the commissioner, −$25 on matches.');
    expect(e.text).not.toContain('Pay the commissioner');
  });

  it('a match loser with no side games is never told to pay the commissioner', () => {
    const w = splitMoney(rows, 'di', 'golfers');
    const e = buildRecapEmail({ ...base, playerName: 'Di', weekCents: w.commissioner, seasonCents: null, matchCents: w.match });
    expect(e.text).toContain('You lost $15 on your match and presses.');
    expect(e.text).not.toContain('Pay the commissioner');
  });

  it('match money through the commissioner keeps one figure and the pay links', () => {
    const w = splitMoney(rows, 'di', 'commissioner');
    const e = buildRecapEmail({ ...base, playerName: 'Di', weekCents: w.commissioner, seasonCents: null, matchCents: w.match });
    expect(e.text).toContain('You owe $15 this week.');
    expect(e.text).toContain('Pay the commissioner');
  });
});
