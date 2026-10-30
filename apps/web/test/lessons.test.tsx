import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { FORMAT_NAMES, isQuiz, isTap, LESSONS } from '../src/lessons/lessons';
import { TapContext } from '../src/lessons/Pretend';

describe('lessons', () => {
  it('has every format for golfers and for commissioners', () => {
    for (const who of ['golfers', 'commissioners'] as const) {
      const formats = LESSONS.filter((l) => l.for === who).map((l) => l.format).sort();
      expect(formats).toEqual(Object.keys(FORMAT_NAMES).sort());
    }
  });

  it('has unique ids', () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
  });

  for (const lesson of LESSONS) {
    describe(lesson.id, () => {
      it('has at least one tap step and one quiz', () => {
        expect(lesson.steps.some(isTap)).toBe(true);
        expect(lesson.steps.some(isQuiz)).toBe(true);
      });

      it('gives every quiz exactly one right answer', () => {
        for (const s of lesson.steps.filter(isQuiz)) {
          expect(s.opts.filter((o) => o.right)).toHaveLength(1);
        }
      });

      it('shows the glowing button on every tap step, every tap', () => {
        lesson.steps.forEach((s) => {
          if (!isTap(s)) return;
          for (let taps = 0; taps < (s.times ?? 1); taps++) {
            const html = renderToString(
              <MemoryRouter>
                <TapContext.Provider value={{ target: s.tap, tap: () => {} }}>{s.screen(taps)}</TapContext.Provider>
              </MemoryRouter>,
            );
            expect(html, `${lesson.id} step "${s.tap}" tap ${taps}`).toContain(`data-tap="${s.tap}"`);
            expect(html).toContain('tap-glow');
          }
        });
      });
    });
  }
});
