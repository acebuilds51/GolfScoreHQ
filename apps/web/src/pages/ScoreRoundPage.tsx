import { scoreMatch, totalsByPlayer } from '@golfscorehq/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorText, PageSkeleton } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync, useLeague } from '../lib/hooks';
import { applyQueue, compact, enqueue, flush, readQueue, type FlushResult, type PendingOp } from '../lib/pendingQueue';
import { asBestBall, basicRules, currentMarker, fmtMoney, holesCompleted, matchSoFar, scoreMark, toEngineRound } from '../lib/scoring';
import type { CtpEntry, Layout, Player, RoundData, Season } from '../lib/types';
import { loadWeek, teamName } from './WeekPage';

const NO_MARKER = '__no_marker__';
const NOBODY = '__nobody__';

export function ScoreRoundPage() {
  const { roundId = '' } = useParams();
  const { league } = useLeague();
  const data = useAsync(async () => {
    const r = await api.round(roundId);
    if (!r) return null;
    const week = await loadWeek(league.id, r.eventId);
    return week ? { ...week, round: r } : null;
  }, [league.id, roundId]);

  if (data.error) return <div className="page"><ErrorText>{data.error}</ErrorText></div>;
  if (!data.data) return (data.loading ? <PageSkeleton cards={1} /> : <div className="page muted">Round not found.</div>);
  const { round, layout, season, players, rounds, event } = data.data;
  if (!layout || !season) return <div className="page"><p className="muted">This week has no course or season set up yet.</p></div>;
  const locked = event.status === 'settled' || event.status === 'rainout';
  return <Scorer key={round.id} initial={round} layout={layout} season={season} players={players} others={rounds.filter((r) => r.id !== round.id)} eventId={event.id} locked={locked} />;
}

function Scorer({ initial, layout, season, players, others, eventId, locked }: { initial: RoundData; layout: Layout; season: Season; players: Player[]; others: RoundData[]; eventId: string; locked: boolean }) {
  const { league } = useLeague();
  const nav = useNavigate();
  const rules = asBestBall(season.rules);
  const names = useMemo(() => new Map(players.map((p) => [p.id, p.displayName])), [players]);
  // Start from what the server has plus anything still waiting on this phone, so nothing looks lost.
  const [round, setRound] = useState<RoundData>(() => applyQueue(initial, readQueue(initial.id)));
  const [holeIdx, setHoleIdx] = useState(() => Math.min(applyQueue(initial, readQueue(initial.id)).currentHole, layout.holes.length - 1));
  const [reviewing, setReviewing] = useState(() => initial.status === 'submitted' || holesCompleted(applyQueue(initial, readQueue(initial.id)), layout) === layout.holes.length);
  const [queue, setQueue] = useState<PendingOp[]>(() => compact(readQueue(initial.id)));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<FlushResult['problem']>(null);
  const [cheer, setCheer] = useState<string | null>(null);
  const clearCheer = useCallback(() => setCheer(null), []);
  // Swipe left for the next hole, right for the previous one.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const { busy, error, setError, run } = useAction();

  const hole = layout.holes[holeIdx]!;
  const isPar3 = hole.par === 3;
  const ctpOn = rules.ctp.enabled && isPar3;

  // Draft scores for this hole: what's saved, or par to start.
  const [draft, setDraft] = useState<Record<string, number>>({});
  useEffect(() => {
    setDraft(Object.fromEntries(round.players.map((p) => [p.playerId, round.scores[p.playerId]?.[hole.number] ?? hole.par])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeIdx]);

  const sendQueue = useCallback(async () => {
    if (!queueRef.current.length) return;
    setSaving(true);
    const r = await flush(league.id, round.id, queueRef.current);
    setQueue(r.left);
    setProblem(r.problem);
    setSaving(false);
  }, [league.id, round.id]);

  useEffect(() => {
    const t = setInterval(sendQueue, 15000);
    const online = () => sendQueue();
    window.addEventListener('online', online);
    sendQueue();
    return () => { clearInterval(t); window.removeEventListener('online', online); };
  }, [sendQueue]);

  const push = (op: PendingOp) => setQueue((q) => (queueRef.current = enqueue(round.id, op, q)));

  // CTP answers for this hole
  const saved = round.ctp[hole.number];
  const marker = useMemo(() => (ctpOn ? currentMarker(others, layout, hole.number) : { holder: null, disputed: false }), [ctpOn, others, layout, hole.number]);
  const [ctpWho, setCtpWho] = useState('');
  const [ctpBeat, setCtpBeat] = useState('');
  useEffect(() => {
    setCtpWho(saved ? saved.playerId ?? NOBODY : '');
    setCtpBeat(saved?.playerId ? saved.beat ?? NO_MARKER : marker.holder ?? NO_MARKER);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeIdx]);

  const status = matchSoFar(round, layout, season.rules);
  const sideIds = (s: 'A' | 'B' | null) => round.players.filter((p) => p.side === s).map((p) => p.playerId);
  const hasMatch = sideIds('A').length > 0 && sideIds('B').length > 0;

  function commitHole(): RoundData | null {
    if (ctpOn && !ctpWho) {
      setError('Answer the closest-to-the-pin question first.');
      return null;
    }
    const entries = round.players.map((p) => ({ playerId: p.playerId, holeNumber: hole.number, strokes: draft[p.playerId] ?? hole.par }));
    const next: RoundData = {
      ...round,
      scores: { ...round.scores },
      ctp: { ...round.ctp },
    };
    for (const e of entries) next.scores[e.playerId] = { ...next.scores[e.playerId], [e.holeNumber]: e.strokes };
    push({ kind: 'scores', entries });
    if (ctpOn) {
      const entry: CtpEntry = ctpWho === NOBODY ? { playerId: null, beat: null } : { playerId: ctpWho, beat: ctpBeat === NO_MARKER ? null : ctpBeat };
      next.ctp[hole.number] = entry;
      push({ kind: 'ctp', holeNumber: hole.number, entry });
    }
    setRound(next);
    setError(null);
    return next;
  }

  const go = (idx: number) => {
    setHoleIdx(idx);
    push({ kind: 'hole', holeIndex: idx });
    setTimeout(sendQueue, 0);
    window.scrollTo(0, 0);
  };

  if (reviewing || locked) {
    return (
      <Review
        round={round} layout={layout} season={season} names={names} queueLength={queue.length} busy={busy} error={error} locked={locked} eventId={eventId}
        onEditHole={(i) => { setReviewing(false); go(i); }}
        onSubmit={async () => {
          const r = await flush(league.id, round.id, queueRef.current);
          setQueue(r.left);
          setProblem(r.problem);
          if (r.left.length) {
            return setError(
              r.problem && r.problem !== 'offline'
                ? r.problem
                : 'No connection right now. Your scores are saved on this phone. Try again when you have signal.',
            );
          }
          const ok = await run(async () => { await api.submitRound(round.id); return true; });
          if (ok) nav(`../week/${eventId}`);
        }}
      />
    );
  }

  const toParLabel = (d: number) => (d <= -3 ? 'Albatross' : d === -2 ? 'Eagle' : d === -1 ? 'Birdie' : d === 0 ? '' : d === 1 ? 'Bogey' : d === 2 ? 'Double' : `+${d}`);
  const lead = status.result.holesWon.A - status.result.holesWon.B;
  const matchLine = !hasMatch ? null
    : lead === 0 ? (status.thru ? `All square thru ${status.thru}` : null)
    : `${teamName(sideIds(lead > 0 ? 'A' : 'B'), names)} ${Math.abs(lead)} up thru ${status.thru}`;
  const step = (playerId: string, by: number) => {
    // Count from the latest value, not the rendered one, so quick double-taps both count.
    setDraft((d) => ({ ...d, [playerId]: Math.min(20, Math.max(1, (d[playerId] ?? hole.par) + by)) }));
    navigator.vibrate?.(8);
  };
  const next = () => {
    const done = commitHole();
    if (!done) return;
    celebrate(done);
    if (holeIdx < layout.holes.length - 1) go(holeIdx + 1);
    else { setTimeout(sendQueue, 0); setReviewing(true); window.scrollTo(0, 0); }
  };
  const back = () => { if (holeIdx > 0 && commitHole()) go(holeIdx - 1); };
  function celebrate(r: RoundData) {
    const best = r.players
      .map((p) => ({ id: p.playerId, s: r.scores[p.playerId]?.[hole.number] ?? hole.par }))
      .sort((a, b) => a.s - b.s)[0];
    if (!best) return;
    const d = best.s - hole.par;
    const first = (names.get(best.id) ?? '').split(' ')[0];
    if (best.s === 1) setCheer(`Hole in one! ${first}`);
    else if (d <= -2) setCheer(`${d <= -3 ? 'Albatross' : 'Eagle'}! ${first}`);
  }

  return (
    <div
      className="page stack scorer"
      onTouchStart={(e) => { const t = e.touches[0]!; touch.current = { x: t.clientX, y: t.clientY }; }}
      onTouchEnd={(e) => {
        const s = touch.current; touch.current = null;
        if (!s || (e.target as HTMLElement).closest('select, input, button, .card')) return;
        const t = e.changedTouches[0]!;
        const dx = t.clientX - s.x, dy = t.clientY - s.y;
        if (Math.abs(dx) > 70 && Math.abs(dy) < 50) (dx < 0 ? next : back)();
      }}
    >
      {cheer && <Cheer text={cheer} onDone={clearCheer} />}
      <div className="row between">
        <Link to={`../week/${eventId}`} className="small">← Week</Link>
        <span className={`small ${queue.length ? 'warn' : 'muted'}`}>{saving ? 'Saving…' : queue.length ? (problem === 'offline' ? 'No signal · saved on this phone' : 'Waiting to save') : 'Saved'}</span>
      </div>
      {problem && problem !== 'offline' && <p className="small warn">{problem}</p>}

      <div className="hole-hero">
        <div className="hole-hero-top">
          <div>
            <div className="hole-hero-label">Hole</div>
            <div className="num hole-hero-num">{hole.number}</div>
          </div>
          <div className="num hole-hero-par">Par {hole.par}</div>
        </div>
        {matchLine && <div className="hole-hero-match">{matchLine}</div>}
      </div>

      <div className="score-list">
        {round.players.map((p) => {
          const v = draft[p.playerId] ?? hole.par;
          const label = toParLabel(v - hole.par);
          return (
            <div key={p.playerId} className="score-row">
              <div className="grow">
                <div className="score-name">{names.get(p.playerId) ?? '?'}</div>
                {(label || p.side === null) && <div className={`small ${v < hole.par ? 'under' : 'muted'}`}>{[label, p.side === null ? 'skins only' : ''].filter(Boolean).join(' · ')}</div>}
              </div>
              <button type="button" className="step minus" aria-label={`One fewer stroke for ${names.get(p.playerId)}`} onClick={() => step(p.playerId, -1)}>−</button>
              <span className={`num score-big${v < hole.par ? ' under' : ''}`}>{v}</span>
              <button type="button" className="step plus" aria-label={`One more stroke for ${names.get(p.playerId)}`} onClick={() => step(p.playerId, 1)}>+</button>
            </div>
          );
        })}
      </div>

      {ctpOn && (
        <section className="card stack ctp">
          <h3>Closest to the pin — {fmtMoney(rules.ctp.amountPerHole)}</h3>
          <p className="small">Current marker: <strong>{marker.disputed ? 'disputed' : marker.holder ? names.get(marker.holder) ?? '?' : 'none yet'}</strong></p>
          <label>
            Did anyone in your group get inside it?
            <select value={ctpWho} onChange={(e) => { setCtpWho(e.target.value); setError(null); }}>
              <option value="">Choose…</option>
              <option value={NOBODY}>No — nobody in our group</option>
              {round.players.map((p) => <option key={p.playerId} value={p.playerId}>Yes — {names.get(p.playerId)}</option>)}
            </select>
          </label>
          {ctpWho && ctpWho !== NOBODY && (
            <label>
              Whose ball were they inside of?
              <select value={ctpBeat} onChange={(e) => setCtpBeat(e.target.value)}>
                <option value={NO_MARKER}>No marker yet — first ball on the green</option>
                {[...players].sort((a, b) => a.displayName.localeCompare(b.displayName)).filter((p) => !round.players.some((rp) => rp.playerId === p.id)).map((p) => (
                  <option key={p.id} value={p.id}>{p.displayName}</option>
                ))}
              </select>
            </label>
          )}
        </section>
      )}

      {rules.presses.enabled && hasMatch && (
        <Presses round={round} layout={layout} holeNumber={hole.number} names={names} onChange={setRound} />
      )}

      <ErrorText>{error}</ErrorText>
      <div className="hole-nav">
        {holeIdx > 0 ? <button type="button" className="btn" onClick={back}>← Back</button> : <span />}
        <button type="button" className="btn btn-primary" onClick={next}>{holeIdx < layout.holes.length - 1 ? 'Next hole →' : 'Review scores'}</button>
      </div>
      <p className="small muted center hint-swipe">Swipe to change holes</p>
    </div>
  );
}

/** A quick celebration for an eagle, albatross or ace. */
function Cheer({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    navigator.vibrate?.([30, 40, 30]);
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="cheer" role="status" onClick={onDone}>
      <div className="cheer-burst" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ ['--i' as string]: i }} />)}</div>
      <div className="num cheer-text">{text}</div>
    </div>
  );
}

function Presses({ round, layout, holeNumber, names, onChange }: { round: RoundData; layout: Layout; holeNumber: number; names: Map<string, string>; onChange: (r: RoundData) => void }) {
  const { league } = useLeague();
  const { busy, error, run } = useAction();
  const sideNames = (s: 'A' | 'B') => teamName(round.players.filter((p) => p.side === s).map((p) => p.playerId), names);
  const thru = holesCompleted(round, layout);
  const tally = (start: number) => {
    const from = layout.holes.findIndex((h) => h.number === start);
    const won = { A: 0, B: 0 };
    const m = scoreMatch(toEngineRound(round, layout, true), layout.holes.length, basicRules());
    m.holeWinners.slice(from, thru).forEach((w) => { if (w) won[w]++; });
    return won;
  };
  const call = async (side: 'A' | 'B') => {
    const id = await run(() => api.addPress(league.id, round.id, holeNumber, side));
    if (id) onChange({ ...round, presses: [...round.presses, { id, startHole: holeNumber, calledBy: side }] });
  };
  return (
    <section className="card stack press-panel">
      <h3>Presses</h3>
      {round.presses.length === 0 && <p className="small muted">No presses yet.</p>}
      {round.presses.map((p, i) => {
        const t = tally(p.startHole);
        return (
          <div key={p.id} className="row between small">
            <span>Press {i + 1}: {sideNames(p.calledBy)} from hole {p.startHole}</span>
            <span className="row">
              <strong>{t.A}–{t.B}</strong>
              {p.startHole === holeNumber && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => { await run(() => api.removePress(p.id)); onChange({ ...round, presses: round.presses.filter((x) => x.id !== p.id) }); }}>Undo</button>
              )}
            </span>
          </div>
        );
      })}
      <div className="row wrap">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => call('A')}>{sideNames('A')} press</button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => call('B')}>{sideNames('B')} press</button>
      </div>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

function Review({ round, layout, season, names, queueLength, busy, error, locked, eventId, onEditHole, onSubmit }: {
  round: RoundData; layout: Layout; season: Season; names: Map<string, string>; queueLength: number; busy: boolean; error: string | null;
  locked: boolean; eventId: string; onEditHole: (i: number) => void; onSubmit: () => void;
}) {
  const rules = asBestBall(season.rules);
  const m = scoreMatch(toEngineRound(round, layout), layout.holes.length, rules);
  const money = totalsByPlayer(m.ledger);
  const par = layout.holes.reduce((s, h) => s + h.par, 0);
  const sideIds = (s: 'A' | 'B') => round.players.filter((p) => p.side === s).map((p) => p.playerId);
  const hasMatch = sideIds('A').length > 0 && sideIds('B').length > 0;
  const complete = holesCompleted(round, layout) === layout.holes.length;

  return (
    <div className="page stack">
      <Link to={`../week/${eventId}`} className="small">← Week</Link>
      <h2>{round.status === 'submitted' || locked ? 'Scorecard' : 'Review and submit'}</h2>
      <p className="small muted">{locked ? 'This week is final. The commissioner can reopen it to fix a score.' : 'Tap a hole number to fix a score.'}</p>
      <div className="card flush scroll-x">
        <table className="scorecard">
          <thead>
            <tr>
              <th>Hole</th>
              {layout.holes.map((h, i) => <th key={h.number}>{locked ? h.number : <button type="button" className="linkish" onClick={() => onEditHole(i)}>{h.number}</button>}</th>)}
              <th>Tot</th>
            </tr>
            <tr className="muted"><td>Par</td>{layout.holes.map((h) => <td key={h.number}>{h.par}</td>)}<td>{par}</td></tr>
          </thead>
          <tbody>
            {round.players.map((p) => {
              const s = layout.holes.map((h) => round.scores[p.playerId]?.[h.number] ?? null);
              const tot = s.reduce<number>((t, v) => t + (v ?? 0), 0);
              return (
                <tr key={p.playerId}>
                  <td className="name">{(names.get(p.playerId) ?? '?').split(' ')[0]}{p.side === null ? '*' : ''}</td>
                  {s.map((v, i) => {
                    const d = v == null ? null : v - layout.holes[i]!.par;
                    const won = hasMatch && p.side && m.holeWinners[i] === p.side;
                    return <td key={i} className={`${won ? 'won' : ''} ${scoreMark(d)}`}><span>{v ?? '–'}</span></td>;
                  })}
                  <td><strong>{tot || '–'}</strong></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasMatch && (
        <section className="card stack">
          <h3>Match</h3>
          <p>
            {m.winner === null ? `Halved ${m.holesWon.A}–${m.holesWon.B}` : `${teamName(sideIds(m.winner), names)} win ${Math.max(m.holesWon.A, m.holesWon.B)}–${Math.min(m.holesWon.A, m.holesWon.B)}`}
          </p>
          {m.presses.map((p, i) => (
            <p key={i} className="small">Press {i + 1} (from hole {layout.holes[p.startHoleIndex]?.number}): {p.winner ? `${teamName(sideIds(p.winner), names)} win ${p.holesWon[p.winner]}–${p.holesWon[p.winner === 'A' ? 'B' : 'A']}` : `halved ${p.holesWon.A}–${p.holesWon.B}`}</p>
          ))}
          {Object.keys(money).length > 0 && (
            <div className="small">
              {round.players.filter((p) => p.side).map((p) => {
                const c = money[p.playerId] ?? 0;
                return <div key={p.playerId} className="row between"><span>{names.get(p.playerId)}</span><span className={c > 0 ? 'good' : c < 0 ? 'warn' : 'muted'}>{c > 0 ? '+' : c < 0 ? '−' : ''}{fmtMoney(Math.abs(c))}</span></div>;
              })}
              {!locked && <p className="muted">Skins and closest to the pin are added when the week is settled.</p>}
            </div>
          )}
        </section>
      )}

      <ErrorText>{error}</ErrorText>
      {queueLength > 0 && <p className="warn small">Some scores are saved on this phone but haven't reached the league yet.</p>}
      {!locked && <div className="row wrap">
        <button type="button" className="btn btn-primary" disabled={busy || !complete} onClick={onSubmit}>
          {busy ? 'Submitting…' : round.status === 'submitted' ? 'Submit corrections' : 'Submit scores'}
        </button>
        {!complete && <span className="small muted">Every hole needs a score before submitting.</span>}
      </div>}
    </div>
  );
}
