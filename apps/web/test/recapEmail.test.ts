import { describe, expect, it } from 'vitest';
import { buildRecapEmail, paymentOptions } from '../../../supabase/functions/send-recap/email';

const base = {
  leagueName: 'Maple <Thursday> League',
  weekNumber: 3,
  leagueUrl: 'https://golfscorehq.app/l/maple',
  recapBody: 'Maple — Week 3 recap (Front 9)\n\nSKINS\n  Hole 1: Al (+$90)\n\nLOW ROUND: Al — 34 (-2)',
  playerName: 'Bob Banks',
  payment: { venmo: '@maple-commish', paypalMe: 'maplecommish', zelle: 'commish@example.com' },
};

describe('weekly recap email', () => {
  it('tells a winner what they won and their season total', () => {
    const e = buildRecapEmail({ ...base, weekCents: 9500, seasonCents: 18000 });
    expect(e.subject).toBe('Maple <Thursday> League: week 3 results');
    expect(e.text).toContain('Hi Bob,');
    expect(e.text).toContain('You won $95 this week. Season to date: +$180.');
    expect(e.text).not.toContain('Pay the commissioner');
    expect(e.text).toContain('SKINS\n  Hole 1: Al (+$90)');
  });

  it('shows someone who owes how to pay, with the amount filled in', () => {
    const e = buildRecapEmail({ ...base, weekCents: -1500, seasonCents: -500 });
    expect(e.text).toContain('You owe $15 this week. Season to date: −$5.');
    expect(e.text).toContain('Venmo @maple-commish — https://venmo.com/u/maple-commish');
    expect(e.text).toContain('paypal.me/maplecommish/15.00');
    expect(e.html).toContain('href="https://paypal.me/maplecommish/15.00"');
    expect(e.text).toContain('Zelle commish@example.com');
  });

  it('leaves money out for leagues that do not play for it, and escapes HTML', () => {
    const e = buildRecapEmail({ ...base, weekCents: null, seasonCents: null });
    expect(e.text).not.toMatch(/won|owe/);
    expect(e.html).toContain('Maple &lt;Thursday&gt; League');
    expect(e.html).not.toContain('<Thursday>');
  });

  it('puts the write-up above the results, escaped in HTML', () => {
    const e = buildRecapEmail({ ...base, weekCents: 9500, seasonCents: 18000, story: 'Al <finally> found the hole.\n\nBob did not.' });
    expect(e.text).toContain('Season to date: +$180.\n\nAl <finally> found the hole.\n\nBob did not.\n\nMaple — Week 3 recap');
    expect(e.html).toContain('<p style="margin:0 0 8px">Al &lt;finally&gt; found the hole.</p>');
    expect(buildRecapEmail({ ...base, weekCents: null, seasonCents: null, story: '  ' }).text).not.toContain('\n\n\n');
  });

  it("uses the league's colors and logo, with readable text", () => {
    const logoUrl = 'https://abc.supabase.co/storage/v1/object/public/league-logos/x/logo-1.png';
    const dark = buildRecapEmail({ ...base, weekCents: null, seasonCents: null, brand: { color: '#0b5d3b', accent: '#d4a017', logoUrl } });
    expect(dark.html).toContain('background:#0b5d3b;color:#ffffff');
    expect(dark.html).toContain('border-bottom:4px solid #d4a017');
    expect(dark.html).toContain(`<img src="${logoUrl}"`);
    const light = buildRecapEmail({ ...base, weekCents: null, seasonCents: null, brand: { color: '#f2d64b', logoUrl: 'http://insecure.example/logo.png' } });
    expect(light.html).toContain('background:#f2d64b;color:#111111');
    expect(light.html).not.toContain('<img');
    expect(buildRecapEmail({ ...base, weekCents: null, seasonCents: null, brand: { color: 'red;x' } }).html).toContain('background:#14365c');
  });

  it('only lists the payment apps the commissioner set up', () => {
    expect(paymentOptions({ venmo: '', paypalMe: null, zelle: '248-555-0100' }, 500).map((p) => p.label)).toEqual(['Zelle 248-555-0100']);
  });
});
