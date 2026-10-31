import type { LessonResult } from './types';

// Staff view of the lessons: per lesson, how many tried and finished, where the
// ones who didn't finish stopped, and which quiz questions people miss.

export interface LessonStat {
  lessonId: string;
  tries: number;
  finished: number;
  /** Felt it: counts from the finish screen. */
  feel: { easy: number; ok: number; hard: number };
  /** Steps where unfinished tries stopped (0-based), most first. */
  quitAt: { step: number; count: number }[];
  /** Quiz steps (0-based) and how often they were missed, of the tries that answered them; worst first. */
  missed: { step: number; count: number; of: number }[];
  ideas: { idea: string; feel: LessonResult['feel']; email: string | null; at: string }[];
}

/** A try untouched this long without finishing has stopped (not still going). */
const STOPPED_AFTER_MS = 30 * 60 * 1000;

export function lessonStats(rows: LessonResult[], now = Date.now()): Map<string, LessonStat> {
  const out = new Map<string, LessonStat>();
  for (const r of rows) {
    let s = out.get(r.lessonId);
    if (!s) out.set(r.lessonId, (s = { lessonId: r.lessonId, tries: 0, finished: 0, feel: { easy: 0, ok: 0, hard: 0 }, quitAt: [], missed: [], ideas: [] }));
    s.tries++;
    if (r.finished) s.finished++;
    if (r.feel) s.feel[r.feel]++;
    if (!r.finished && now - Date.parse(r.updatedAt) > STOPPED_AFTER_MS) bump(s.quitAt, r.reached);
    for (const step of new Set(r.missed)) {
      const m = s.missed.find((x) => x.step === step);
      if (m) m.count++;
      else s.missed.push({ step, count: 1, of: 0 });
    }
    if (r.idea) s.ideas.push({ idea: r.idea, feel: r.feel ?? null, email: r.email, at: r.updatedAt });
  }
  // How many tries got past each missed question (answered it), for "missed by 3 of 10".
  for (const s of out.values()) {
    const mine = rows.filter((r) => r.lessonId === s.lessonId);
    for (const m of s.missed) m.of = mine.filter((r) => r.finished || r.reached > m.step || r.missed.includes(m.step)).length;
    s.quitAt.sort((a, b) => b.count - a.count || a.step - b.step);
    s.missed.sort((a, b) => b.count / b.of - a.count / a.of || b.count - a.count);
  }
  return out;
}

function bump(list: { step: number; count: number }[], step: number) {
  const x = list.find((q) => q.step === step);
  if (x) x.count++;
  else list.push({ step, count: 1 });
}
