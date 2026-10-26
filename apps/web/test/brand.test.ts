import { describe, expect, it } from 'vitest';
import { brandLogo, brandStyle, PALETTES, textOn } from '../src/lib/brand';

describe('league branding', () => {
  it('picks readable text for any color', () => {
    expect(textOn('#0b5d3b')).toBe('#ffffff');
    expect(textOn('#14365c')).toBe('#ffffff');
    expect(textOn('#f2d64b')).toBe('#111111');
    expect(textOn('#ffffff')).toBe('#111111');
    for (const p of PALETTES) expect(['#ffffff', '#111111']).toContain(textOn(p.brand));
  });

  it("applies colors and logo only while the league has branding", () => {
    const l = { brandColor: '#0b5d3b', accentColor: '#d4a017', logoUrl: 'https://x/logo.png' };
    expect(brandStyle({ ...l, features: ['branding'] })).toEqual({
      '--league': '#0b5d3b', '--on-league': '#ffffff', '--league-accent': '#d4a017', '--on-league-accent': '#111111',
    });
    expect(brandStyle({ ...l, features: [] })).toBeUndefined();
    expect(brandLogo({ ...l, features: [] })).toBeNull();
    expect(brandStyle({ brandColor: null, accentColor: null, features: ['branding'] })).toBeUndefined();
  });
});
