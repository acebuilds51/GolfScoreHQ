import { describe, expect, it } from 'vitest';
import { ghinRound } from '../src/components/Ghin';
import type { Layout, RoundData } from '../src/lib/types';

const layout = { id: 'f9', name: 'Front 9', tees: 'White', rating: null, slope: null, holes: [1, 2, 3].map((number) => ({ number, par: 4 })) } as Layout;
const round = (scores: Record<number, number>) => ({ scores: { al: scores } }) as unknown as RoundData;

describe('Post to GHIN', () => {
  it('writes out a finished round hole by hole with the total', () => {
    expect(ghinRound(round({ 1: 5, 2: 3, 3: 4 }), 'al', layout)).toEqual({
      holes: [{ number: 1, par: 4, strokes: 5 }, { number: 2, par: 4, strokes: 3 }, { number: 3, par: 4, strokes: 4 }],
      total: 12,
    });
  });

  it('waits until every hole has a score', () => {
    expect(ghinRound(round({ 1: 5, 2: 3 }), 'al', layout)).toBeNull();
    expect(ghinRound(round({}), 'bo', layout)).toBeNull();
  });
});
