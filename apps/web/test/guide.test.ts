import { describe, expect, it } from 'vitest';
import { GUIDES, guideText } from '../../../supabase/functions/ask-help/guide';
import { HELP_SECTIONS } from '../../../supabase/functions/ask-help/manual';
import { guideHref, searchGuide } from '../src/lib/guideSearch';

const helpIds = new Set(HELP_SECTIONS.flatMap((s) => s.items.map((i) => i.id)));

describe("user's guide", () => {
  it('has a guide for commissioners and one for golfers', () => {
    expect(GUIDES.map((g) => g.id)).toEqual(['commissioners', 'golfers']);
  });

  it('links every "More" to a real Help answer', () => {
    const missing = GUIDES.flatMap((g) => g.chapters.flatMap((c) => c.steps.filter((s) => s.help && !helpIds.has(s.help)).map((s) => `${g.id}/${c.id}: ${s.help}`)));
    expect(missing).toEqual([]);
  });

  it('gives every chapter a unique id and at least one step', () => {
    for (const g of GUIDES) {
      const ids = g.chapters.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const c of g.chapters) expect(c.steps.length).toBeGreaterThan(0);
    }
  });

  it('finds the guide chapter for a "what do I do first" search', () => {
    const top = searchGuide("I'm a new commissioner. What do I do first, step by step?")[0];
    expect(top && guideHref(top)).toBe('/guide#set-up');
    expect(guideHref(searchGuide('how do I keep the card on league night')[0]!)).toBe('/guide?for=golfers#night');
  });

  it('hands the helper both guides as plain text, with Pro marked', () => {
    const text = guideText();
    expect(text).toContain("# Commissioner's guide");
    expect(text).toContain("# Golfer's guide");
    expect(text).toContain('## 6. After the round: settle up');
    expect(text).toMatch(/Settle the week.*\(needs Pro\)/);
    expect(text).toContain('Home is called Overview');
  });
});
