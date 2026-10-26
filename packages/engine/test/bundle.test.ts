import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { bundleEngine } from '../../../scripts/build-shared.mjs';

describe('server functions bundle', () => {
  it('matches the engine source (run `npm run build:functions` if this fails)', async () => {
    const committed = readFileSync(new URL('../../../supabase/functions/_shared/engine.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(await bundleEngine());
  });
});
