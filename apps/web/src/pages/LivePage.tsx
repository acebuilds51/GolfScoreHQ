import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, ErrorText } from '../components/ui';
import { api } from '../lib/backend';
import { useAsync, useLeague, useLiveRefresh } from '../lib/hooks';
import { fmtLiveToPar, liveBoard, type LiveBoard } from '../lib/live';
import { asBestBall, fmtDate } from '../lib/scoring';
import type { FormatRules } from '@golfscorehq/engine';
import { loadWeek, teamName } from './WeekPage';

/** The week to show: the one being played now (an open week with groups), else the latest open week. */
async function currentEventId(leagueId: string): Promise<string | null> {
  const seasons = await api.seasons(leagueId);
  const season = seasons[0];
  if (!season) return null;
  const events = await api.events(season.id);
  const open = events.filter((e) => e.status === 'scheduled' || e.status === 'in_progress');
  for (const e of [...open].reverse()) {
    if ((await api.eventRounds(e.id)).length) return e.id;
  }
  return (open[0] ?? events.at(-1))?.id ?? null;
}

export function LivePage() {
  const { eventId: fromUrl } = useParams();
  const { league } = useLeague();
  const target = useAsync(async () => fromUrl ?? (await currentEventId(league.id)), [league.id, fromUrl]);
  if (target.error) return <div className="page"><ErrorText>{target.error}</ErrorText></div>;
  if (target.loading && !target.data) return <div className="page muted">Loading…</div>;
  if (!target.data) {
    return <div className="page"><EmptyState title="Nothing live yet"><p className="muted">The live leaderboard shows the week being played. Add a week on the <Link to="../play">Play</Link> tab.</p></EmptyState></div>;
  }
  return <LiveWeek eventId={target.data} />;
}

function LiveWeek({ eventId }: { eventId: string }) {
  const { league } = useLeague();
  const data = useAsync(() => loadWeek(league.id, eventId), [league.id, eventId]);
  const settled = data.data?.event.status === 'settled';
  const updatedAt = useLiveRefresh(league.id, data.reload, !settled);
  const names = useMemo(() => new Map((data.data?.players ?? []).map((p) => [p.id, p.displayName])), [data.data]);
  const board = useMemo(() => (data.data?.layout && data.data.season ? liveBoard(data.data.rounds, data.data.layout, data.data.season.rules) : null), [data.data]);

  if (data.error) return <div className="page"><ErrorText>{data.error}</ErrorText></div>;
  if (!data.data) return <div className="page muted">Loading…</div>;
  const { event, layout, season } = data.data;
  if (!layout || !season || !board) return <div className="page"><p className="muted">This week has no course set up yet.</p></div>;

  return (
    <div className="page stack live">
      <div className="row between wrap">
        <div>
          <h2>Week {event.weekNumber}{event.eventDate ? ` · ${fmtDate(event.eventDate)}` : ''}</h2>
          <p className="small muted">{layout.courseName} · {layout.name}</p>
        </div>
        <div className="row small">
          {settled ? <span className="badge badge-ok">Final</span> : <span className="live-dot">Live</span>}
          {!settled && <span className="muted">Updated {updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>}
          <Link to={`../week/${event.id}`}>Week page</Link>
        </div>
      </div>
      {board.lines.length === 0 ? (
        <EmptyState title="No scores yet"><p className="muted">Scores show up here as soon as groups enter them.</p></EmptyState>
      ) : (
        <div className="live-grid">
          <LeaderPanel board={board} names={names} holes={layout.holes.length} />
          <div className="stack">
            <MatchesPanel board={board} names={names} holes={layout.holes.length} />
            {board.skins.length > 0 && <SkinsPanel board={board} names={names} />}
            {board.ctp.length > 0 && <CtpPanel board={board} names={names} />}
            <HighlightsPanel board={board} names={names} />
          </div>
        </div>
      )}
      <RulesNote rules={season.rules} />
    </div>
  );
}

type PanelProps = { board: LiveBoard; names: Map<string, string> };
const first = (names: Map<string, string>, id: string) => names.get(id) ?? '?';

export function LeaderPanel({ board, names, holes }: PanelProps & { holes: number }) {
  let rank = 0;
  let prev: number | null = null;
  return (
    <section className="card flush">
      <h3 className="pad">Leaderboard</h3>
      <table className="live-table">
        <thead><tr><th>#</th><th className="left">Golfer</th><th>Thru</th><th>Score</th><th>To par</th></tr></thead>
        <tbody>
          {board.lines.map((l, i) => {
            if (l.toPar !== prev) rank = i + 1;
            prev = l.toPar;
            return (
              <tr key={`${l.roundId}-${l.playerId}`}>
                <td className="muted">{rank}</td>
                <td className="left"><strong>{first(names, l.playerId)}</strong>{l.side === null && <span className="small muted"> · skins</span>}</td>
                <td>{l.finished ? 'F' : l.thru}<span className="muted small">{l.finished ? '' : `/${holes}`}</span></td>
                <td>{l.strokes}</td>
                <td className={l.toPar < 0 ? 'under' : ''}><strong>{fmtLiveToPar(l.toPar)}</strong></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function MatchesPanel({ board, names, holes }: PanelProps & { holes: number }) {
  return (
    <section className="card stack">
      <h3>Groups <span className="small muted">{board.groupsDone} in · {board.groupsOnCourse} on the course</span></h3>
      {board.matches.map((m) => (
        <div key={m.roundId} className="row small match-line">
          <span className="tee-badge">{m.teeSlot}</span>
          <span className="grow">
            {teamName(m.teamA, names)}{m.teamB.length > 0 && <> <span className="muted">vs</span> {teamName(m.teamB, names)}</>}
            <span className="muted"> · {m.label}</span>
          </span>
          <span className={`badge ${m.status === 'submitted' ? 'badge-ok' : 'badge-live'}`}>{m.status === 'submitted' ? 'In' : m.thru >= holes ? 'Done' : `Hole ${m.thru + 1}`}</span>
        </div>
      ))}
    </section>
  );
}

export function SkinsPanel({ board, names }: PanelProps) {
  const leaders = board.skins.filter((s) => s.playerId);
  return (
    <section className="card stack">
      <h3>Skins so far</h3>
      {leaders.length === 0 ? <p className="small muted">No outright low scores yet.</p> : leaders.map((s) => (
        <div key={s.holeNumber} className="row between small"><span>Hole {s.holeNumber}</span><span><strong>{first(names, s.playerId!)}</strong> <span className="muted">({s.score})</span></span></div>
      ))}
      <p className="small muted">Leaders can be tied by later groups. Skins are paid when the week is settled.</p>
    </section>
  );
}

export function CtpPanel({ board, names }: PanelProps) {
  return (
    <section className="card stack">
      <h3>Closest to the pin</h3>
      {board.ctp.map((c) => (
        <div key={c.holeNumber} className="row between small">
          <span>Hole {c.holeNumber}</span>
          <span>{c.disputed ? <span className="warn">Disputed</span> : c.holder ? <strong>{first(names, c.holder)}</strong> : <span className="muted">No marker yet</span>}</span>
        </div>
      ))}
    </section>
  );
}

export function HighlightsPanel({ board, names }: PanelProps) {
  if (!board.highlights.length) return null;
  const label = { ace: 'Hole-in-one', eagle: 'Eagle', birdie: 'Birdie' } as const;
  return (
    <section className="card stack">
      <h3>Highlights</h3>
      <div className="week-chips">
        {board.highlights.map((h, i) => (
          <span key={i} className={`chip ${h.kind}`}>{label[h.kind]} · {first(names, h.playerId).split(' ')[0]} · #{h.holeNumber}</span>
        ))}
      </div>
    </section>
  );
}

function RulesNote({ rules }: { rules: FormatRules }) {
  const r = asBestBall(rules);
  if (!r.skins.enabled && !r.ctp.enabled) return null;
  return <p className="small muted">Everything here is live and unofficial until the commissioner settles the week.</p>;
}
