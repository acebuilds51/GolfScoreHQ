import { useState } from 'react';
import { EmptyState, ErrorText } from '../components/ui';
import type { CourseSummary, LookupCourse, LookupTee } from '../lib/api';
import { api } from '../lib/backend';
import { layoutsFromTee, teeLabel, type CourseShape } from '../lib/courseImport';
import { useAction, useAsync, useLeague } from '../lib/hooks';
import { isCommissioner, type Course, type Layout } from '../lib/types';
import { PAR_36 } from '../lib/util';

interface DraftLayout {
  name: string;
  tees: string;
  firstHole: number;
  pars: number[];
  strokeIndexes: number[] | null;
  rating: string;
  slope: string;
  ratingEstimated: boolean;
}

const blank = (name: string, firstHole: number, count: 9 | 18): DraftLayout => ({
  name, tees: '', firstHole, rating: '', slope: '', strokeIndexes: null, ratingEstimated: false,
  pars: count === 9 ? [...PAR_36] : [...PAR_36, ...PAR_36],
});

function blankDrafts(shape: CourseShape): DraftLayout[] {
  if (shape === 'two-nines') return [blank('Front 9', 1, 9), blank('Back 9', 10, 9)];
  if (shape === 'one-nine') return [blank('9 holes', 1, 9)];
  return [blank('18 holes', 1, 18)];
}

function importedDrafts(tee: LookupTee, shape: CourseShape): DraftLayout[] {
  return layoutsFromTee(tee, shape).map((l) => ({
    ...l, rating: l.rating === null ? '' : String(l.rating), slope: l.slope === null ? '' : String(l.slope),
  }));
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
          <p className="muted">Search for your course and the scorecard fills in, or enter the pars yourself.</p>
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
  const hasSi = layout.holes.every((h) => h.strokeIndex);
  return (
    <div>
      <div className="row between small wrap">
        <strong>{layout.name}{layout.tees ? ` · ${layout.tees} tees` : ''}</strong>
        <span className="muted">Par {par}{layout.rating ? ` · Rating ${layout.rating}` : ''}{layout.slope ? ` · Slope ${layout.slope}` : ''}</span>
      </div>
      <div className="scroll-x">
        <table className="holes">
          <tbody>
            <tr><th>Hole</th>{layout.holes.map((h) => <td key={h.number}>{h.number}</td>)}</tr>
            <tr><th>Par</th>{layout.holes.map((h) => <td key={h.number}>{h.par}</td>)}</tr>
            {hasSi && <tr><th>Hcp</th>{layout.holes.map((h) => <td key={h.number} className="muted">{h.strokeIndex}</td>)}</tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Search the course lookup, pick a course and a set of tees. */
function CourseFinder({ onPick }: { onPick: (course: LookupCourse, tee: LookupTee) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CourseSummary[] | null>(null);
  const [course, setCourse] = useState<LookupCourse | null>(null);
  const [teeIdx, setTeeIdx] = useState(0);
  const { busy, error, setError, run } = useAction();

  if (course) {
    return (
      <div className="subcard stack">
        <div className="row between wrap">
          <strong>{course.clubName}{course.courseName !== course.clubName ? ` — ${course.courseName}` : ''}</strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCourse(null)}>Pick a different course</button>
        </div>
        {course.tees.length === 0 ? (
          <p className="warn small">This course has no scorecard on file. Enter the pars below.</p>
        ) : (
          <>
            <label>
              Which tees does your league play?
              <select value={teeIdx} onChange={(e) => setTeeIdx(Number(e.target.value))}>
                {course.tees.map((t, i) => <option key={i} value={i}>{teeLabel(t)}</option>)}
              </select>
            </label>
            <div><button type="button" className="btn btn-primary btn-sm" onClick={() => onPick(course, course.tees[teeIdx]!)}>Use these tees</button></div>
          </>
        )}
      </div>
    );
  }

  const search = async () => {
    if (query.trim().length < 3) return setError('Type at least 3 letters of the course name.');
    const r = await run(() => api.searchCourses(query.trim()));
    if (r) setResults(r);
  };

  return (
    <div className="subcard stack">
      <label>
        Find your course
        <div className="row">
          <input
            placeholder={api.mode === 'demo' ? 'Try “maple” or “pine”' : 'Shepherds Hollow'}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
          />
          <button type="button" className="btn" disabled={busy} onClick={search}>{busy ? 'Searching…' : 'Search'}</button>
        </div>
      </label>
      <ErrorText>{error}</ErrorText>
      {results && results.length === 0 && <p className="small muted">No courses found. Try part of the name, or enter the pars below.</p>}
      {results && results.length > 0 && (
        <ul className="list picker">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const c = await run(() => api.lookupCourse(r.id));
                  if (c) { setCourse(c); setTeeIdx(0); }
                }}
              >
                <strong>{r.clubName}</strong>
                {r.courseName !== r.clubName && <span> — {r.courseName}</span>}
                <span className="small muted"> {[r.city, r.state].filter(Boolean).join(', ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddCourse({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { league } = useLeague();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [shape, setShape] = useState<CourseShape>('two-nines');
  const [layouts, setLayouts] = useState<DraftLayout[]>(blankDrafts('two-nines'));
  const [imported, setImported] = useState<{ course: LookupCourse; tee: LookupTee } | null>(null);
  const { busy, error, setError, run } = useAction();

  const update = (i: number, patch: Partial<DraftLayout>) => setLayouts((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const nineHoleTee = imported?.tee.holes.length === 9;

  const changeShape = (s: CourseShape) => {
    setShape(s);
    setLayouts(imported ? importedDrafts(imported.tee, s) : blankDrafts(s));
  };

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
            ...(imported ? { source: { provider: 'golfcourseapi' as const, id: imported.course.id } } : {}),
            layouts: layouts.map((l, i) => ({
              name: l.name.trim() || `Layout ${i + 1}`,
              tees: l.tees.trim() || null,
              holes: l.pars.map((par, k) => ({ number: l.firstHole + k, par, ...(l.strokeIndexes ? { strokeIndex: l.strokeIndexes[k]! } : {}) })),
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

      {!imported ? (
        <CourseFinder
          onPick={(course, tee) => {
            const s: CourseShape = tee.holes.length === 9 ? 'one-nine' : shape;
            setImported({ course, tee });
            setName(course.courseName && course.courseName !== course.clubName && !/^main$/i.test(course.courseName) ? `${course.clubName} — ${course.courseName}` : course.clubName);
            setCity(course.city ?? '');
            setState((course.state ?? '').slice(0, 2).toUpperCase());
            setShape(s);
            setLayouts(importedDrafts(tee, s));
            setError(null);
          }}
        />
      ) : (
        <div className="notice small row between wrap">
          <span>Filled in from the {imported.tee.name} tees. Check it against your scorecard before saving.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setImported(null); setLayouts(blankDrafts(shape)); }}>Start over</button>
        </div>
      )}

      <div className="grid three">
        <label>Course name<input placeholder="The Links at Crystal Lake" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} /></label>
        <label>City<input placeholder="Pontiac" value={city} onChange={(e) => setCity(e.target.value)} /></label>
        <label>State<input placeholder="MI" maxLength={2} value={state} onChange={(e) => setState(e.target.value.toUpperCase())} /></label>
      </div>
      {!nineHoleTee && (
        <fieldset className="segmented">
          <legend className="small muted">How does your league play it?</legend>
          {([['two-nines', 'Front and back nines'], ['one-nine', imported ? 'Front nine only' : 'A 9-hole course'], ['eighteen', '18 holes']] as [CourseShape, string][]).map(([v, label]) => (
            <label key={v} className={shape === v ? 'on' : ''}>
              <input type="radio" name="shape" checked={shape === v} onChange={() => changeShape(v)} />
              {label}
            </label>
          ))}
        </fieldset>
      )}

      {layouts.map((l, i) => (
        <div key={`${shape}-${i}`} className="subcard stack">
          <div className="grid four">
            <label>Name<input value={l.name} onChange={(e) => update(i, { name: e.target.value })} /></label>
            <label>Tees<input placeholder="White" value={l.tees} onChange={(e) => update(i, { tees: e.target.value })} /></label>
            <label>Rating<input inputMode="decimal" placeholder={l.pars.length === 9 ? '34.5' : '69.8'} value={l.rating} onChange={(e) => update(i, { rating: e.target.value, ratingEstimated: false })} /></label>
            <label>Slope<input inputMode="numeric" placeholder="118" value={l.slope} onChange={(e) => update(i, { slope: e.target.value })} /></label>
          </div>
          {l.ratingEstimated && (
            <p className="warn small">Rating is estimated from the 18-hole rating. Use the 9-hole rating from your scorecard if it lists one.</p>
          )}
          <div className="scroll-x">
            <table className="holes edit">
              <tbody>
                <tr><th>Hole</th>{l.pars.map((_, k) => <td key={k}>{l.firstHole + k}</td>)}<td><strong>Total</strong></td></tr>
                <tr>
                  <th>Par</th>
                  {l.pars.map((p, k) => (
                    <td key={k}>
                      <input
                        aria-label={`Par for hole ${l.firstHole + k}`}
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
                {l.strokeIndexes && (
                  <tr><th>Hcp</th>{l.strokeIndexes.map((s, k) => <td key={k} className="muted">{s}</td>)}<td /></tr>
                )}
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
