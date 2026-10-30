import { createContext, useContext, type ReactNode } from 'react';

// Pretend screens for the lessons: they look like the app, but nothing is saved.
// The button a step wants tapped glows; the others do nothing.

export const TapContext = createContext<{ target: string | null; tap: (id: string) => void }>({ target: null, tap: () => undefined });

/** A pretend button. When it's the one the step asks for, it glows and tapping it moves the lesson on. */
export function Tap({ id, className = 'btn', children }: { id: string; className?: string; children: ReactNode }) {
  const { target, tap } = useContext(TapContext);
  const on = target === id;
  return (
    <button type="button" data-tap={id} className={`${className}${on ? ' tap-glow' : ''}`} onClick={() => on && tap(id)}>
      {children}
    </button>
  );
}

/** The phone the pretend screen sits in. */
export function Phone({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="pretend" aria-label="Practice screen">
      {title && <div className="pretend-bar">{title}</div>}
      <div className="pretend-body stack">{children}</div>
    </div>
  );
}

export interface CardRow {
  name: string;
  score: number;
  /** The small line under the name: Bogey, 2 pts here · 2 total, −1 thru 1… */
  note?: string;
  /** Tap ids for the − and + buttons. */
  minus?: string;
  plus?: string;
}

/** The scorecard, like ScoreRoundPage: the hole, the match line, a row per golfer with − and +. */
export function Card({ hole, par, line, rows, extra, nextId, nextLabel = 'Next hole →' }: {
  hole: number; par: number; line?: string; rows: CardRow[]; extra?: ReactNode; nextId?: string; nextLabel?: string;
}) {
  return (
    <>
      <div className="hole-hero">
        <div className="hole-hero-top">
          <div>
            <div className="hole-hero-label">Hole</div>
            <div className="num hole-hero-num">{hole}</div>
          </div>
          <div className="num hole-hero-par">Par {par}</div>
        </div>
        {line && <div className="hole-hero-match">{line}</div>}
      </div>
      <div className="score-list">
        {rows.map((r) => (
          <div key={r.name} className="score-row">
            <div className="grow">
              <div className="score-name">{r.name}</div>
              {r.note && <div className={`small ${r.score < par ? 'under' : 'muted'}`}>{r.note}</div>}
            </div>
            {r.minus ? <Tap id={r.minus} className="step minus">−</Tap> : <span className="step minus pretend-off">−</span>}
            <span className={`num score-big${r.score < par ? ' under' : ''}`}>{r.score}</span>
            {r.plus ? <Tap id={r.plus} className="step plus">+</Tap> : <span className="step plus pretend-off">+</span>}
          </div>
        ))}
      </div>
      {extra}
      {nextId && <div className="hole-nav"><span /><Tap id={nextId} className="btn btn-primary">{nextLabel}</Tap></div>}
    </>
  );
}

/** A filled-in form field, read only. */
export function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="pretend-field">
      <span className="small muted">{label}</span>
      <span className="pretend-input">{value}</span>
    </div>
  );
}

/** A ticked (or not) checkbox line. */
export function Check({ on, children }: { on: boolean; children: ReactNode }) {
  return <div className="pretend-check"><span aria-hidden="true">{on ? '☑' : '☐'}</span> {children}</div>;
}

/** Name and value lines: results, groups, payouts. */
export function Lines({ title, rows }: { title?: string; rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="pretend-lines">
      {title && <strong>{title}</strong>}
      {rows.map(([a, b], i) => <div key={i} className="row between small"><span>{a}</span><span>{b}</span></div>)}
    </div>
  );
}

/** The format picker on the Play tab's Edit format. */
export function Formats({ picked, tapId }: { picked?: string; tapId?: { label: string; id: string } }) {
  const all = ['2 vs 2 best ball match', 'Stroke play', 'Stableford', 'Scramble'];
  return (
    <div className="stack pretend-formats">
      <strong>Format</strong>
      {all.map((f) => (tapId?.label === f
        ? <Tap key={f} id={tapId.id} className="pretend-option">○ {f}</Tap>
        : <div key={f} className={`pretend-option${picked === f ? ' on' : ''}`}>{picked === f ? '◉' : '○'} {f}</div>))}
    </div>
  );
}
