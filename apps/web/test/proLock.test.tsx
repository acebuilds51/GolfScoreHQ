import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProLock } from '../src/components/ui';
import { LeagueContext } from '../src/lib/hooks';
import { PRO_FEATURES } from '../src/lib/plans';
import type { League } from '../src/lib/types';

const inLeague = (plan: string) => (node: React.ReactNode) =>
  renderToString(<LeagueContext.Provider value={{ league: { id: 'l1', slug: 'ocbc', effectivePlan: plan } as unknown as League, reloadLeague: () => {} }}>{node}</LeagueContext.Provider>);

describe('Pro badges', () => {
  it('can be tapped in a free league', () => {
    const html = inLeague('free')(<ProLock feature="awards" />);
    expect(html).toContain('<button');
    expect(html).toContain('pro-tap');
  });

  it('are just a label once the league has Pro, or outside a league', () => {
    expect(inLeague('pro')(<ProLock feature="awards" />)).not.toContain('<button');
    expect(renderToString(<ProLock />)).not.toContain('<button');
  });

  it('say something about every feature', () => {
    for (const f of Object.values(PRO_FEATURES)) {
      expect(f.name.length).toBeGreaterThan(3);
      expect(f.what).toMatch(/\.$/);
    }
  });
});
