import { useState } from 'react';
import { EmptyState, ErrorText } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync, useLeague } from '../lib/hooks';
import { isCommissioner, type Course, type Layout } from '../lib/types';
import { PAR_36 } from '../lib/util';

type Shape = 'two-nines' | 'one-nine' | 'eighteen';

interface DraftLayout {
  name: string;
  tees: string;
  pars: number[];
  rating: string;
  slope: string;
}

const draft = (name: string, count: 9 | 18): DraftLayout => ({
  name, tees: '', rating: '', slope: '',
  pars: count === 9 ? [...PAR_36] : [...PAR_36, ...PAR_36],
});

function draftsFor(shape: Shape): DraftLayout[] {
  if (shape === 'two-nines') return [draft('Front 9', 9), draft('Back 9', 9)];
  if (shape === 'one-nine') return [draft('9 holes', 9)];
  return [draft('18 holes', 18)];
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

export function CoursesPage() {
  const { league } = useLeague();
  const commish = isCommissioner(league.role);
  const courses = useAsync(() => api.courses(league.id), [league.id]);
  const [adding, setAdding] = useState(false);

  return (
    <div className="page stack">
      {courses.error && <ErrorText>{courses.error}</ErrorText>}
      {courses.data && courses.data.length === 0 && !adding && (
        <EmptyState title="Add the course you play">
          <p className="muted">Enter the par for each hole. Course rating and slope (from the scorecard) make handicaps accurate.</p>
        </EmptyState>
      )}
      {courses.data?.map((c) => <CourseCard key={c.id} course={c} commish={commish && c.leagueId === league.id} onChanged={courses.reload} />)}
      {commish && (adding ? (
        <AddCourse onDone={() => { setAdding(false); courses.reload(); }} onCancel={() => setAdding(false)} />
      ) : (
        <div><button className="btn btn-primary" onClick={() => setAdding(true)}>Add a course</button></div>
      ))}
    </div>
  );
}

function CourseCard({ course, commish, onChanged }: { course: Course; commish: boolean; onChanged: () => void }) {
  const { busy, error, run } = useAction();
  return (
    <section className="card stack">
      <div className="row between">
        <div>
          <h2>{course.name}</h2>
          {(course.city || course.state) && <p className="small muted">{[course.city, course.state].filter(Boolean).join(', ')}</p>}
        </div>
        {commish && (
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(`Remove ${course.name}? Rounds already played on it keep their scores.`)) return;
              await run(() => api.deleteCourse(course.id));
              onChanged();
            }}
          >
            Remove
          </button>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      {course.layouts.map((l) => <LayoutTable key={l.id} layout={l} />)}
    </section>
  );
}

function LayoutTable({ layout }: { layout: Layout }) {
  const par = sum(layout.holes.map((h) => h.par));
  return (
    <div>
      <div className="row between small">
        <strong>{layout.name}{layout.tees ? ` · ${layout.tees} tees` : ''}</strong>
        <span className="muted">Par {par}{layout.rating ? ` · Rating ${layout.rating}` : ''}{layout.slope ? ` · Slope ${layout.slope}` : ''}</span>
      </div>
      <div className="scroll-x">
        <table className="holes">
          <tbody>
            <tr><th>Hole</th>{layout.holes.map((h) => <td key={h.number}>{h.number}</td>)}</tr>
            <tr><th>Par</th>{layout.holes.map((h) => <td key={h.number}>{h.par}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddCourse({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { league } = useLeague();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [shape, setShape] = useState<Shape>('two-nines');
  const [layouts, setLayouts] = useState<DraftLayout[]>(draftsFor('two-nines'));
  const { busy, error, setError, run } = useAction();

  const update = (i: number, patch: Partial<DraftLayout>) => setLayouts((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const firstHole = (i: number) => (shape === 'two-nines' && i === 1 ? 10 : 1);

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return setError('Enter the course name.');
        for (const l of layouts) {
          if (l.pars.some((p) => !(p >= 3 && p <= 6))) return setError(`${l.name}: every par must be 3, 4, 5 or 6.`);
          if (l.rating && !(Number(l.rating) > 20 && Number(l.rating) < 90)) return setError(`${l.name}: rating looks off. Use the number from the scorecard, e.g. 34.5.`);
          if (l.slope && !(Number(l.slope) >= 55 && Number(l.slope) <= 155)) return setError(`${l.name}: slope must be between 55 and 155.`);
        }
        const ok = await run(async () => {
          await api.createCourse(league.id, {
            name: name.trim(), city: city.trim(), state: state.trim(),
            layouts: layouts.map((l, i) => ({
              name: l.name.trim() || `Layout ${i + 1}`,
              tees: l.tees.trim() || null,
              holes: l.pars.map((par, k) => ({ number: firstHole(i) + k, par })),
              rating: l.rating ? Number(l.rating) : null,
              slope: l.slope ? Number(l.slope) : null,
            })),
          });
          return true;
        });
        if (ok) onDone();
      }}
    >
      <h2>Add a course</h2>
      <div className="grid three">
        <label>Course name<input placeholder="The Links at Crystal Lake" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} /></label>
        <label>City<input placeholder="Pontiac" value={city} onChange={(e) => setCity(e.target.value)} /></label>
        <label>State<input placeholder="MI" maxLength={2} value={state} onChange={(e) => setState(e.target.value.toUpperCase())} /></label>
      </div>
      <fieldset className="segmented">
        <legend className="small muted">How does your league play it?</legend>
        {([['two-nines', 'Front and back nines'], ['one-nine', 'A 9-hole course'], ['eighteen', '18 holes']] as [Shape, string][]).map(([v, label]) => (
          <label key={v} className={shape === v ? 'on' : ''}>
            <input type="radio" name="shape" checked={shape === v} onChange={() => { setShape(v); setLayouts(draftsFor(v)); }} />
            {label}
          </label>
        ))}
      </fieldset>

      {layouts.map((l, i) => (
        <div key={i} className="subcard stack">
          <div className="grid four">
            <label>Name<input value={l.name} onChange={(e) => update(i, { name: e.target.value })} /></label>
            <label>Tees<input placeholder="White" value={l.tees} onChange={(e) => update(i, { tees: e.target.value })} /></label>
            <label>Rating<input inputMode="decimal" placeholder={l.pars.length === 9 ? '34.5' : '69.8'} value={l.rating} onChange={(e) => update(i, { rating: e.target.value })} /></label>
            <label>Slope<input inputMode="numeric" placeholder="118" value={l.slope} onChange={(e) => update(i, { slope: e.target.value })} /></label>
          </div>
          <div className="scroll-x">
            <table className="holes edit">
              <tbody>
                <tr><th>Hole</th>{l.pars.map((_, k) => <td key={k}>{firstHole(i) + k}</td>)}<td><strong>Total</strong></td></tr>
                <tr>
                  <th>Par</th>
                  {l.pars.map((p, k) => (
                    <td key={k}>
                      <input
                        aria-label={`Par for hole ${firstHole(i) + k}`}
                        inputMode="numeric"
                        value={p || ''}
                        onChange={(e) => {
                          const v = Number(e.target.value.replace(/\D/g, '').slice(-1)) || 0;
                          update(i, { pars: l.pars.map((x, j) => (j === k ? v : x)) });
                          setError(null);
                        }}
                      />
                    </td>
                  ))}
                  <td><strong>{sum(l.pars)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <ErrorText>{error}</ErrorText>
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save course'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
