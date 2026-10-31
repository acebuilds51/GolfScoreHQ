import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FORMAT_NAMES, isQuiz, isTap, lessonById, LESSONS, type Lesson, type LessonFor } from '../lessons/lessons';
import { TapContext } from '../lessons/Pretend';
import { api } from '../lib/backend';
import { useAsync, useAuth } from '../lib/hooks';
import type { LessonProgress, LessonsDone } from '../lib/types';

// Finished lessons are kept on this phone, and for signed-in people in their
// account too, so the list shows them done on every phone. Each try is also
// saved as it goes (lesson_results), so staff can see where people get stuck.
type Done = LessonsDone;
const KEY = 'gshq.lessons';
const loadDone = (): Done => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Done; } catch { return {}; }
};
const saveDone = (d: Done) => {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private browsing: progress just isn't kept */ }
};

/** Save a try. Best effort: with no signal it just isn't counted, and the lesson carries on. */
const save = (p: LessonProgress) => { void api.saveLessonProgress(p).catch(() => {}); };

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)));

/** /lessons: practice league night on pretend screens, for golfers or commissioners, in each format. */
export function LessonsPage() {
  const [params, setParams] = useSearchParams();
  const who: LessonFor = params.get('for') === 'commissioners' ? 'commissioners' : 'golfers';
  const { user } = useAuth();
  const local = useMemo(loadDone, []);
  const mine = useAsync(async () => (user ? api.myLessons() : {}), [user?.id]);
  const done: Done = { ...mine.data, ...local };
  const list = LESSONS.filter((l) => l.for === who);

  return (
    <div className="page narrow stack lessons-page">
      <div>
        <h1>Lessons</h1>
        <p className="muted">Practise league night on pretend screens: tap the glowing button, then answer a quick question or two. Nothing you do here changes your league.</p>
      </div>
      <div className="segmented-row" role="tablist" aria-label="Lessons for">
        {(['golfers', 'commissioners'] as const).map((w) => (
          <button key={w} type="button" role="tab" aria-selected={w === who} className={`chip${w === who ? ' on' : ''}`}
            onClick={() => setParams(w === 'commissioners' ? { for: w } : {}, { replace: true })}>
            {w === 'golfers' ? 'Golfers' : 'Commissioners'}
          </button>
        ))}
      </div>
      <p className="small muted">Pick the format your league plays.</p>
      <div className="lesson-tiles">
        {list.map((l) => (
          <Link key={l.id} to={`/lessons/${l.id}`} className={`card lesson-tile${done[l.id] ? ' done' : ''}`}>
            <span className="lesson-icon" aria-hidden="true">{l.icon}</span>
            <span className="grow">
              <span className="small muted block">{FORMAT_NAMES[l.format]} · {l.mins} min{l.pro ? ' · Pro' : ''}</span>
              <strong>{l.title}</strong>
            </span>
            {done[l.id] && <span className="badge badge-ok">Done ✓</span>}
          </Link>
        ))}
      </div>
      <p className="small muted">Rather read it? The <Link to={who === 'golfers' ? '/guide?for=golfers' : '/guide'}>{who === 'golfers' ? "golfer's" : "commissioner's"} guide</Link> has every step.</p>
    </div>
  );
}

/** /lessons/:id: one lesson, a step at a time. */
export function LessonPage() {
  const { id = '' } = useParams();
  const lesson = lessonById(id);
  if (!lesson) {
    return <div className="page narrow"><h1>Lesson not found</h1><p><Link to="/lessons">All lessons</Link></p></div>;
  }
  return <LessonPlayer key={lesson.id} lesson={lesson} />;
}

function LessonPlayer({ lesson }: { lesson: Lesson }) {
  const [i, setI] = useState(0);
  const [taps, setTaps] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });
  // This try: saved as each step opens, so an unfinished one still shows where it stopped.
  const [id] = useState(newId);
  const missed = useRef<number[]>([]);
  const step = lesson.steps[i];
  const next = () => { setI(i + 1); setTaps(0); setPicked(null); };
  const progress = (extra: Partial<LessonProgress> = {}): LessonProgress => ({
    id, lessonId: lesson.id, steps: lesson.steps.length, reached: Math.min(i, lesson.steps.length), finished: false, missed: missed.current, ...extra,
  });
  useEffect(() => {
    if (i < lesson.steps.length) save(progress());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  if (!step) return <Finish lesson={lesson} right={score.right} total={score.total} progress={progress} />;

  const tapCtx = {
    target: isTap(step) ? step.tap : null,
    tap: () => {
      if (!isTap(step)) return;
      const n = taps + 1;
      if (n >= (step.times ?? 1)) next();
      else setTaps(n);
    },
  };

  return (
    <div className="page narrow stack lesson">
      <div className="row between">
        <Link to={`/lessons${lesson.for === 'commissioners' ? '?for=commissioners' : ''}`} className="small">← Lessons</Link>
        <span className="small muted">{i + 1} of {lesson.steps.length}</span>
      </div>
      <div className="lesson-progress" aria-hidden="true"><span style={{ width: `${(i / lesson.steps.length) * 100}%` }} /></div>
      <h1 className="lesson-title">{lesson.icon} {lesson.title}</h1>

      {isQuiz(step) ? (
        <section className="card stack">
          <p className="lesson-say">{step.quiz}</p>
          <div className="stack">
            {step.opts.map((o, n) => (
              <button key={n} type="button" disabled={picked !== null}
                className={`lesson-opt${picked === n ? (o.right ? ' right' : ' wrong') : ''}${picked !== null && o.right ? ' right' : ''}`}
                onClick={() => {
                  setPicked(n);
                  setScore((s) => ({ right: s.right + (o.right ? 1 : 0), total: s.total + 1 }));
                  if (!o.right) {
                    missed.current = [...missed.current, i];
                    save(progress());
                  }
                }}>
                {o.text}
              </button>
            ))}
          </div>
          {picked !== null && (
            <>
              <p className={step.opts[picked]!.right ? 'good' : 'warn'}>{step.opts[picked]!.why}</p>
              <div><button type="button" className="btn btn-primary" onClick={next}>Next</button></div>
            </>
          )}
        </section>
      ) : (
        <>
          <p className="lesson-say">{step.say}</p>
          <TapContext.Provider value={tapCtx}>
            {isTap(step) ? step.screen(taps) : step.screen}
          </TapContext.Provider>
          {isTap(step)
            ? <p className="small muted center">Tap the glowing button.</p>
            : <div><button type="button" className="btn btn-primary" onClick={next}>Next</button></div>}
        </>
      )}
    </div>
  );
}

const FEELS = [{ k: 'easy', icon: '😀', label: 'Easy' }, { k: 'ok', icon: '🙂', label: 'OK' }, { k: 'hard', icon: '😕', label: 'Hard' }] as const;

function Finish({ lesson, right, total, progress }: {
  lesson: Lesson; right: number; total: number; progress: (extra?: Partial<LessonProgress>) => LessonProgress;
}) {
  const nav = useNavigate();
  const [feel, setFeel] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [idea, setIdea] = useState('');
  const [sent, setSent] = useState(false);
  const others = LESSONS.filter((l) => l.for === lesson.for && l.id !== lesson.id);

  // Saved the moment the lesson is finished, so the list shows it done.
  useEffect(() => {
    const d = loadDone();
    d[lesson.id] = { right, total, at: new Date().toISOString() };
    saveDone(d);
    save(progress({ reached: lesson.steps.length, finished: true, right, total }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id, right, total]);

  return (
    <div className="page narrow stack lesson">
      <h1>{lesson.icon} Done!</h1>
      <p className="lesson-say">{total ? `You got ${right} of ${total} right.` : 'All done.'} {right === total ? 'Nicely played.' : 'The answers are in the guide whenever you need them.'}</p>
      <section className="card stack">
        <strong>How did that feel?</strong>
        <div className="lesson-feel">
          {FEELS.map((f) => (
            <button key={f.k} type="button" className={feel === f.k ? 'on' : ''} onClick={() => setFeel(f.k)}><b aria-hidden="true">{f.icon}</b>{f.label}</button>
          ))}
        </div>
        <div className="lesson-feel">
          <button type="button" className={!changing && feel ? 'on' : ''} onClick={() => setChanging(false)}><b aria-hidden="true">👍</b>It works for me</button>
          <button type="button" className={changing ? 'on' : ''} onClick={() => setChanging(true)}><b aria-hidden="true">✏️</b>I'd change something</button>
        </div>
        {changing && (
          <label>
            How would you like it to work? A step you'd skip, do another way, or a button you wish was there.
            <textarea rows={3} maxLength={1000} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="I'd rather…" />
          </label>
        )}
        {sent ? (
          <p className="good">Thanks! GolfScoreHQ reads every one.</p>
        ) : (
          <div>
            <button type="button" className="btn btn-primary" disabled={!feel && !idea.trim()}
              onClick={() => {
                // Staff see it under Lessons on /staff.
                save(progress({
                  reached: lesson.steps.length, finished: true, right, total,
                  feel: (feel as LessonProgress['feel']) ?? null, idea: changing ? idea.trim() || null : null,
                }));
                setSent(true);
              }}>
              Send
            </button>
          </div>
        )}
      </section>
      <section className="card stack">
        <strong>Next</strong>
        {others.map((l) => <Link key={l.id} to={`/lessons/${l.id}`}>{l.icon} {l.title}</Link>)}
        <button type="button" className="linkish small" onClick={() => nav(`/lessons${lesson.for === 'commissioners' ? '?for=commissioners' : ''}`)}>All lessons</button>
      </section>
    </div>
  );
}
