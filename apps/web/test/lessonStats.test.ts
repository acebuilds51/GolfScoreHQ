import { describe, expect, it } from 'vitest';
import { lessonStats } from '../src/lib/lessonStats';
import type { LessonResult } from '../src/lib/types';

const now = Date.parse('2026-11-03T20:00:00Z');
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const r = (o: Partial<LessonResult>): LessonResult => ({
  lessonId: 'golfer-best-ball', steps: 9, reached: 0, finished: false, missed: [], signedIn: false, email: null, startedAt: ago(90), updatedAt: ago(60), ...o,
});

describe('lesson results for staff', () => {
  it('adds up tries, finishes, where people stop and what they miss', () => {
    const s = lessonStats([
      r({ finished: true, reached: 9, missed: [5], feel: 'hard', idea: 'Skip the presses step', email: 'al@x.com' }),
      r({ finished: true, reached: 9, feel: 'easy' }),
      r({ reached: 4 }),
      r({ reached: 4 }),
      r({ reached: 6, missed: [5] }),
      r({ reached: 2, updatedAt: ago(5) }), // still going: not counted as stopped
      r({ lessonId: 'golfer-scramble', finished: true, reached: 5 }),
    ], now);

    const bb = s.get('golfer-best-ball')!;
    expect(bb).toMatchObject({ tries: 6, finished: 2, feel: { easy: 1, ok: 0, hard: 1 } });
    expect(bb.quitAt).toEqual([{ step: 4, count: 2 }, { step: 6, count: 1 }]);
    // Step 5 answered by the two finishers and the one who got to step 6: missed by 2 of 3.
    expect(bb.missed).toEqual([{ step: 5, count: 2, of: 3 }]);
    expect(bb.ideas).toEqual([{ idea: 'Skip the presses step', feel: 'hard', email: 'al@x.com', at: ago(60) }]);
    expect(s.get('golfer-scramble')).toMatchObject({ tries: 1, finished: 1, quitAt: [], missed: [] });
  });
});
