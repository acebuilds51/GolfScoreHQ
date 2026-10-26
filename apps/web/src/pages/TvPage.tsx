import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/backend';
import { textOn } from '../lib/brand';
import { fmtLiveToPar, liveBoard, type LiveBoard } from '../lib/live';
import { asBestBall, fmtDate, fmtMoney } from '../lib/scoring';
import type { TvFeed, TvPanel } from '../lib/types';

const POLL_MS = 15000;
const PANEL_TITLES: Record<TvPanel, string> = {
  live: 'Leaderboard', matches: 'Matches', skins: 'Skins so far', ctp: 'Closest to the pin', highlights: 'Highlights', standings: 'Season standings',
};

/** Full-screen, no sign-in page for a clubhouse TV: /tv/<token>. */
export function TvPage() {
  const { token = '' } = useParams();
  const [feed, setFeed] = useState<TvFeed | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () => api.tvFeed(token).then((f) => { if (live) { setFeed(f); setFailed(false); } }, () => live && setFailed(true));
    load();
    const t = setInterval(load, POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, [token]);

  // Keep the screen on where the browser allows it.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const get = () => nav.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    get();
    const vis = () => { if (document.visibilityState === 'visible') get(); };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); lock?.release().catch(() => {}); };
  }, []);

  if (feed === undefined) return <TvMessage title={failed ? 'Connecting…' : 'Loading…'} />;
  if (feed === null) return <TvMessage title="This TV link isn't active" text="Ask your commissioner for a new Clubhouse TV link." />;
  if (feed.error === 'plan') return <TvMessage title={feed.league.name} text="Clubhouse TV is part of GolfScoreHQ Pro." />;
  if (!feed.event || !feed.layout || !feed.season) return <TvMessage title={feed.league.name} text="Scores show up here once the season's first week is set up." />;
  return <TvScreen feed={feed} stale={failed} />;
}

function TvMessage({ title, text }: { title: string; text?: string }) {
  return (
    <div className="tv-root tv-center">
      <h1>{title}</h1>
      {text && <p>{text}</p>}
    </div>
  );
}

function TvScreen({ feed, stale }: { feed: TvFeed; stale: boolean }) {
  const settings = feed.display?.settings ?? { hideMoney: true, secondsPerPanel: 15, panels: ['live', 'matches', 'skins', 'ctp', 'highlights', 'standings'] as TvPanel[] };
  const rules = asBestBall(feed.season!.rules);
  const layout = feed.layout!;
  const names = useMemo(() => new Map((feed.players ?? []).map((p) => [p.id, p.displayName])), [feed.players]);
  const board = useMemo(() => liveBoard(feed.rounds ?? [], layout, feed.season!.rules), [feed.rounds, layout, feed.season]);
  const settled = feed.event!.status === 'settled';

  // Panels that have something to show, in the commissioner's order.
  const panels = settings.panels.filter((p) => {
    if (p === 'skins') return rules.skins.enabled && board.lines.length > 0;
    if (p === 'ctp') return rules.ctp.enabled;
    if (p === 'highlights') return board.highlights.length > 0;
    if (p === 'standings') return (feed.standings ?? []).length > 0;
    if (p === 'live' || p === 'matches') return board.lines.length > 0 || board.matches.length > 0;
    return true;
  });
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => i + 1), Math.max(5, settings.secondsPerPanel) * 1000);
    return () => clearInterval(t);
  }, [settings.secondsPerPanel]);
  const panel = panels.length ? panels[idx % panels.length]! : null;

  const flash = useFlash(board, names);
  const clock = useClock();
  const qr = useQr(feed.league.slug ? `${window.location.origin}/l/${feed.league.slug}` : null);
  const ticker = board.highlights.slice(0, 12).map((h) => `${h.kind === 'ace' ? 'Hole-in-one' : h.kind === 'eagle' ? 'Eagle' : 'Birdie'} — ${names.get(h.playerId) ?? '?'}, #${h.holeNumber}`);

  return (
    <div className="tv-root">
      <header
        className={`tv-head${feed.league.brandColor ? ' branded' : ''}`}
        style={{
          ...(feed.league.brandColor ? { background: feed.league.brandColor, color: textOn(feed.league.brandColor) } : {}),
          ...(feed.league.accentColor ? { borderBottomColor: feed.league.accentColor } : {}),
        }}
      >
        {feed.league.logoUrl ? (
          <img className="tv-logo tv-logo-img" src={feed.league.logoUrl} alt="" />
        ) : (
          <div className="tv-logo" aria-hidden="true">{feed.league.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</div>
        )}
        <div className="tv-title">
          <div className="tv-league">{feed.league.name}</div>
          <div className="tv-sub">Week {feed.event!.weekNumber}{feed.event!.eventDate ? ` · ${fmtDate(feed.event!.eventDate)}` : ''} · {layout.courseName ? `${layout.courseName} · ` : ''}{layout.name}</div>
        </div>
        {settled ? <span className="tv-pill final">Final</span> : <span className="tv-pill live">Live</span>}
        {stale && <span className="tv-pill stale">Reconnecting</span>}
        <span className="tv-clock">{clock}</span>
      </header>

      {flash && <div className="tv-flash" role="status">{flash}</div>}

      <main className="tv-main">
        {!panel ? (
          <div className="tv-center"><h2>Waiting for the first scores</h2></div>
        ) : (
          <section className="tv-panel" key={panel}>
            <h2 className="tv-panel-title">{PANEL_TITLES[panel]}</h2>
            {panel === 'live' && <TvLeaderboard board={board} names={names} holes={layout.holes.length} />}
            {panel === 'matches' && <TvMatches board={board} names={names} holes={layout.holes.length} />}
            {panel === 'skins' && <TvSkins board={board} names={names} />}
            {panel === 'ctp' && <TvCtp board={board} names={names} />}
            {panel === 'highlights' && <TvHighlights board={board} names={names} />}
            {panel === 'standings' && <TvStandings feed={feed} names={names} hideMoney={settings.hideMoney} />}
          </section>
        )}
        {panels.length > 1 && (
          <div className="tv-dots" aria-hidden="true">{panels.map((p, i) => <span key={p} className={i === idx % panels.length ? 'on' : ''} />)}</div>
        )}
      </main>

      <footer className="tv-foot">
        <div className="tv-ticker">{ticker.length ? ticker.join('   ·   ') : 'Birdies and eagles show up here as they happen.'}</div>
        {qr && (
          <div className="tv-qr">
            <img src={qr} alt="" width={64} height={64} />
            <span>Follow on your phone</span>
          </div>
        )}
      </footer>
    </div>
  );
}

type P = { board: LiveBoard; names: Map<string, string> };

function TvLeaderboard({ board, names, holes }: P & { holes: number }) {
  const rows = board.lines.slice(0, 12);
  let rank = 0;
  let prev: number | null = null;
  return (
    <table className="tv-table">
      <thead><tr><th>#</th><th className="left">Golfer</th><th>Thru</th><th>Score</th><th>To par</th></tr></thead>
      <tbody>
        {rows.map((l, i) => {
          if (l.toPar !== prev) rank = i + 1;
          prev = l.toPar;
          return (
            <tr key={`${l.roundId}-${l.playerId}`}>
              <td className="dim">{rank}</td>
              <td className="left">{names.get(l.playerId) ?? '?'}{l.side === null && <span className="dim small"> · skins</span>}</td>
              <td>{l.finished ? 'F' : `${l.thru}/${holes}`}</td>
              <td>{l.strokes}</td>
              <td className={l.toPar < 0 ? 'under' : ''}>{fmtLiveToPar(l.toPar)}</td>
            </tr>
          );
        })}
      </tbody>
      {board.lines.length > rows.length && <caption className="dim small">+ {board.lines.length - rows.length} more</caption>}
    </table>
  );
}

const firstNames = (ids: string[], names: Map<string, string>) => ids.map((id) => (names.get(id) ?? '?').split(' ')[0]).join(' / ');

function TvMatches({ board, names, holes }: P & { holes: number }) {
  return (
    <div className="tv-list">
      {board.matches.map((m) => (
        <div key={m.roundId} className="tv-row">
          <span className="tv-tee">{m.teeSlot}</span>
          <span className="grow">{firstNames(m.teamA, names)}{m.teamB.length > 0 && <><span className="dim"> vs </span>{firstNames(m.teamB, names)}</>}</span>
          <span className="tv-status">{m.label}</span>
          <span className={`tv-pill ${m.status === 'submitted' ? 'final' : 'live'}`}>{m.status === 'submitted' ? 'In' : m.thru >= holes ? 'Done' : `Hole ${m.thru + 1}`}</span>
        </div>
      ))}
    </div>
  );
}

function TvSkins({ board, names }: P) {
  return (
    <div className="tv-grid">
      {board.skins.map((s) => (
        <div key={s.holeNumber} className={`tv-cell ${s.playerId ? 'won' : ''}`}>
          <span className="dim">Hole {s.holeNumber}</span>
          <strong>{s.playerId ? names.get(s.playerId) ?? '?' : s.tiedCount > 1 ? `Tied (${s.tiedCount})` : '—'}</strong>
          {s.score !== null && <span className="dim">{s.score}</span>}
        </div>
      ))}
    </div>
  );
}

function TvCtp({ board, names }: P) {
  return (
    <div className="tv-grid">
      {board.ctp.map((c) => (
        <div key={c.holeNumber} className={`tv-cell ${c.holder ? 'won' : ''}`}>
          <span className="dim">Hole {c.holeNumber}</span>
          <strong>{c.disputed ? 'Disputed' : c.holder ? names.get(c.holder) ?? '?' : 'No marker yet'}</strong>
        </div>
      ))}
    </div>
  );
}

function TvHighlights({ board, names }: P) {
  const label = { ace: 'Hole-in-one', eagle: 'Eagle', birdie: 'Birdie' } as const;
  return (
    <div className="tv-grid">
      {board.highlights.slice(0, 12).map((h, i) => (
        <div key={i} className={`tv-cell ${h.kind}`}>
          <span className="dim">{label[h.kind]} · #{h.holeNumber}</span>
          <strong>{names.get(h.playerId) ?? '?'}</strong>
        </div>
      ))}
    </div>
  );
}

function TvStandings({ feed, names, hideMoney }: { feed: TvFeed; names: Map<string, string>; hideMoney: boolean }) {
  const rows = [...(feed.standings ?? [])]
    .sort(hideMoney ? (a, b) => b.skins + b.ctps - (a.skins + a.ctps) : (a, b) => b.money - a.money)
    .slice(0, 10);
  return (
    <table className="tv-table">
      <thead><tr><th>#</th><th className="left">Golfer</th><th>Skins</th><th>CTP</th>{!hideMoney && <th>Money</th>}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.playerId}>
            <td className="dim">{i + 1}</td>
            <td className="left">{names.get(r.playerId) ?? '?'}</td>
            <td>{r.skins || ''}</td>
            <td>{r.ctps || ''}</td>
            {!hideMoney && <td className={r.money > 0 ? 'up' : ''}>{r.money > 0 ? '+' : r.money < 0 ? '−' : ''}{fmtMoney(Math.abs(r.money))}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A banner for 10 seconds when a new eagle/ace lands or someone takes a skin outright. */
function useFlash(board: LiveBoard, names: Map<string, string>) {
  const seen = useRef<Set<string> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const events = [
      ...board.highlights.filter((h) => h.kind !== 'birdie').map((h) => ({ key: `h:${h.playerId}:${h.holeNumber}`, text: `${h.kind === 'ace' ? 'Hole-in-one' : 'Eagle'} — ${names.get(h.playerId) ?? '?'}, hole ${h.holeNumber}` })),
      ...board.skins.filter((s) => s.playerId).map((s) => ({ key: `s:${s.holeNumber}:${s.playerId}`, text: `Skin leader — ${names.get(s.playerId!) ?? '?'}, hole ${s.holeNumber}` })),
    ];
    if (seen.current === null) {
      seen.current = new Set(events.map((e) => e.key)); // don't flash what was already there when the TV turned on
      return;
    }
    const fresh = events.find((e) => !seen.current!.has(e.key));
    events.forEach((e) => seen.current!.add(e.key));
    if (!fresh) return;
    setMsg(fresh.text);
    const t = setTimeout(() => setMsg(null), 10000);
    return () => clearTimeout(t);
  }, [board, names]);
  return msg;
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function useQr(url: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    QRCode.toDataURL(url, { margin: 1, width: 128, color: { dark: '#04213f', light: '#ffffff' } }).then(setSrc, () => setSrc(null));
  }, [url]);
  return src;
}
