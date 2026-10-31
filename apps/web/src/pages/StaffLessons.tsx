import { useState } from 'react';
import { ErrorText } from '../components/ui';
import { isQuiz, LESSONS, type Lesson } from '../lessons/lessons';
import { api } from '../lib/backend';
import { useAsync } from '../lib/hooks';
import { lessonStats } from '../lib/lessonStats';

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–');

/** What a step says, for "they stop at step 4: …". */
function StepText({ lesson, step }: { lesson: Lesson; step: number }) {
  const s = lesson.steps[step];
  if (!s) return <>step {step + 1}</>;
  return <>step {step + 1}: <span className="muted">{isQuiz(s) ? s.quiz : s.say}</span></>;
}

/** Staff: where people get stuck in the lessons. */
export function StaffLessons() {
  const [days, setDays] = useState(30);
  const rows = useAsync(() => api.staffLessonResults(days), [days], { fresh: true });
  const stats = lessonStats(rows.data ?? []);
  const tries = rows.data?.length ?? 0;
  const ideas = LESSONS.flatMap((l) => (stats.get(l.id)?.ideas ?? []).map((i) => ({ ...i, lesson: l })));

  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>Lessons</h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="How far back">
          <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last year</option>
        </select>
      </div>
      <ErrorText>{rows.error}</ErrorText>
      <p className="small muted">
        {tries} {tries === 1 ? 'try' : 'tries'}, {(rows.data ?? []).filter((r) => r.signedIn).length} by signed-in people.
        "Stopped at" counts tries left unfinished for half an hour; "missed" is out of the people who answered that question.
      </p>
      {!rows.data ? <p className="small muted">Loading…</p> : tries === 0 ? <p className="small muted">Nobody has tried a lesson in this time.</p> : (
        <div className="stack">
          {LESSONS.map((l) => {
            const s = stats.get(l.id);
            if (!s) return null;
            const stop = s.quitAt[0];
            const miss = s.missed.find((m) => m.count > 0);
            return (
              <div key={l.id} className="subcard stack" style={{ gap: 6 }}>
                <div className="row between wrap">
                  <strong>{l.icon} {l.title}</strong>
                  <span className="small muted">{l.for === 'golfers' ? 'Golfers' : 'Commissioners'}</span>
                </div>
                <p className="small">
                  {s.tries} tried · <strong>{s.finished} finished ({pct(s.finished, s.tries)})</strong>
                  {s.feel.easy + s.feel.ok + s.feel.hard > 0 && <> · 😀 {s.feel.easy} 🙂 {s.feel.ok} <span className={s.feel.hard ? 'warn' : ''}>😕 {s.feel.hard}</span></>}
                </p>
                {stop && <p className="small">Most stop at <StepText lesson={l} step={stop.step} /> ({stop.count})</p>}
                {miss && <p className="small">Most missed: <StepText lesson={l} step={miss.step} /> <span className="warn">({miss.count} of {miss.of})</span></p>}
              </div>
            );
          })}
        </div>
      )}
      {ideas.length > 0 && (
        <details>
          <summary className="small">What people would change ({ideas.length})</summary>
          <ul className="list">
            {ideas.map((i, n) => (
              <li key={n} className="list-row">
                <div className="grow stack" style={{ gap: 4 }}>
                  <span className="pre-wrap">{i.idea}</span>
                  <span className="small muted">
                    {i.lesson.title}{i.feel ? ` · felt ${i.feel}` : ''} · {new Date(i.at).toLocaleDateString()}
                    {i.email && <> · <a href={`mailto:${i.email}`}>{i.email}</a></>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
