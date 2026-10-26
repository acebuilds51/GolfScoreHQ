import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EmptyState, ErrorText, PageSkeleton } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync, useLeague, useLiveRefresh } from '../lib/hooks';
import { allLayouts, fmtDate, matchSoFar } from '../lib/scoring';
import { isCommissioner, type Layout, type Player, type RoundData, type RoundPlayer, type Season } from '../lib/types';
import { WeekResults } from './WeekResults';
import { WhosPlaying } from './WhosPlaying';

/** Load everything a week needs; reused by the scoring screen. */
export async function loadWeek(leagueId: string, eventId: string) {
  const [event, seasons, courses, players, rounds] = await Promise.all([
    api.event(eventId), api.seasons(leagueId), api.courses(leagueId), api.players(leagueId), api.eventRounds(eventId),
  ]);
  if (!event) return null;
  const season = seasons.find((s) => s.id === event.seasonId) ?? null;
  const layout = allLayouts(courses).find((l) => l.id === event.layoutId) ?? null;
  return { event, season, layouts: allLayouts(courses), layout, players, rounds };
}

export const teamName = (ids: string[], names: Map<string, string>) => ids.map((id) => (names.get(id) ?? '?').split(' ')[0]).join(' / ');

export function WeekPage() {
  const { eventId = '' } = useParams();
  const { league } = useLeague();
  const commish = isCommissioner(league.role);
  const data = useAsync(() => loadWeek(league.id, eventId), [league.id, eventId]);
  const [starting, setStarting] = useState(false);

  // Live: refresh as groups enter scores while the week is open.
  useLiveRefresh(league.id, data.reload, data.data?.event.status !== 'settled');

  if (data.error) return <div className="page"><ErrorText>{data.error}</ErrorText></div>;
  if (!data.data) return (data.loading ? <PageSkeleton /> : <div className="page muted">Week not found.</div>);
  const { event, season, layout, layouts, players, rounds } = data.data;
  const names = new Map(players.map((p) => [p.id, p.displayName]));

  return (
    <div className="page stack">
      <div className="row between wrap">
        <div>
          <Link to="../play" className="small">← All weeks</Link>
          <h2>Week {event.weekNumber}{event.eventDate ? ` · ${fmtDate(event.eventDate)}` : ''}</h2>
          <p className="small muted">{layout ? `${layout.courseName} · ${layout.name} · par ${layout.holes.reduce((s, h) => s + h.par, 0)}` : 'No course picked for this week'}</p>
        </div>
        {commish && event.status === 'scheduled' && <LayoutPicker eventId={event.id} layoutId={event.layoutId} layouts={layouts} onChanged={data.reload} />}
      </div>

      {layout && season && event.status !== 'settled' && event.status !== 'rainout' && (
        starting
          ? <StartGroup eventId={event.id} rounds={rounds} players={players} onCancel={() => setStarting(false)} />
          : <div><button className="btn btn-primary" onClick={() => setStarting(true)}>Start scoring a group</button></div>
      )}

      {event.status === 'scheduled' && <WhosPlaying eventId={event.id} weekNumber={event.weekNumber} players={players} />}

      {layout && season && <WeekResults event={event} season={season} layout={layout} rounds={rounds} names={names} onChanged={data.reload} />}

      <section className="card flush">
        <div className="row between pad">
          <h2>Groups</h2>
          {rounds.length > 0 && <Link className="small" to={`../live/${event.id}`}>Live leaderboard →</Link>}
        </div>
        {rounds.length === 0 ? (
          <EmptyState title="No groups yet"><p className="muted">Each group starts scoring from their phone.</p></EmptyState>
        ) : (
          <ul className="list">
            {rounds.map((r) => (
              <GroupRow key={r.id} round={r} names={names} layout={layout} season={season} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function GroupRow({ round, names, layout, season }: { round: RoundData; names: Map<string, string>; layout: Layout | null; season: Season | null }) {
  const side = (s: 'A' | 'B' | null) => round.players.filter((p) => p.side === s).map((p) => p.playerId);
  const status = layout && season ? matchSoFar(round, layout, season.rules) : null;
  const extra = side(null);
  return (
    <li>
      <Link className="list-row link-row" to={`../round/${round.id}`}>
        <span className="tee-badge">{round.teeSlot}</span>
        <div className="grow">
          <strong>{teamName(side('A'), names)}</strong>
          {side('B').length > 0 && <> <span className="muted">vs</span> <strong>{teamName(side('B'), names)}</strong></>}
          {extra.length > 0 && <span className="small muted"> + {teamName(extra, names)} (skins)</span>}
          <div className="small muted">{status?.label}</div>
        </div>
        <span className={`badge ${round.status === 'submitted' ? 'badge-ok' : 'badge-live'}`}>{round.status === 'submitted' ? 'Submitted' : status && status.thru ? `Hole ${Math.min(status.thru + 1, layout!.holes.length)}` : 'On the tee'}</span>
      </Link>
    </li>
  );
}

function LayoutPicker({ eventId, layoutId, layouts, onChanged }: { eventId: string; layoutId: string | null; layouts: ReturnType<typeof allLayouts>; onChanged: () => void }) {
  const { busy, error, run } = useAction();
  return (
    <label className="small">
      Course this week
      <select
        value={layoutId ?? ''}
        disabled={busy}
        onChange={async (e) => { await run(() => api.updateEvent(eventId, { layoutId: e.target.value || null })); onChanged(); }}
      >
        <option value="">Pick a course</option>
        {layouts.map((l) => <option key={l.id} value={l.id}>{l.courseName} · {l.name}</option>)}
      </select>
      <ErrorText>{error}</ErrorText>
    </label>
  );
}

/** Pick the tee time and who's playing, then go to the scoring screen. */
function StartGroup({ eventId, rounds, players, onCancel }: { eventId: string; rounds: RoundData[]; players: Player[]; onCancel: () => void }) {
  const { league } = useLeague();
  const nav = useNavigate();
  const usedSlots = new Set(rounds.map((r) => r.teeSlot));
  const busyPlayers = useMemo(() => new Set(rounds.flatMap((r) => r.players.map((p) => p.playerId))), [rounds]);
  const firstFree = [...Array(30).keys()].map((i) => i + 1).find((n) => !usedSlots.has(n)) ?? 1;
  const [teeSlot, setTeeSlot] = useState(String(firstFree));
  const [picks, setPicks] = useState<string[]>(['', '', '', '', '']);
  const [subName, setSubName] = useState('');
  const [extraNames, setExtraNames] = useState<{ id: string; name: string }[]>([]);
  const { busy, error, setError, run } = useAction();

  const roster = [...players.filter((p) => p.active), ...extraNames.map((x) => ({ id: x.id, displayName: x.name, isSub: true, active: true, userId: null }))]
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const slotLabels = ['Team A — player 1', 'Team A — player 2', 'Team B — player 1', 'Team B — player 2', 'Skins and CTP only (optional)'];

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const n = Number(teeSlot);
        if (!(n >= 1 && n <= 99)) return setError('Pick your tee time number.');
        const chosen = picks.filter(Boolean);
        if (!picks[0]) return setError('Pick at least the first Team A player.');
        if (new Set(chosen).size !== chosen.length) return setError('Each golfer can only be picked once.');
        const roundPlayers: RoundPlayer[] = picks
          .map((id, i) => (id ? { playerId: id, side: i < 2 ? 'A' : i < 4 ? 'B' : null, position: i } as RoundPlayer : null))
          .filter((p): p is RoundPlayer => p !== null);
        const id = await run(() => api.startRound(league.id, eventId, n, roundPlayers));
        if (id) nav(`../round/${id}`);
      }}
    >
      <div className="row between">
        <h2>Start scoring a group</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
      <label className="inline">
        Tee time
        <input inputMode="numeric" value={teeSlot} onChange={(e) => setTeeSlot(e.target.value.replace(/\D/g, ''))} />
        {usedSlots.has(Number(teeSlot)) && <span className="warn small">Another group already has tee time {teeSlot}. Only continue if you're joining them.</span>}
      </label>
      <div className="grid two">
        {slotLabels.map((label, i) => (
          <label key={label}>
            {label}
            <select value={picks[i]} onChange={(e) => { const v = [...picks]; v[i] = e.target.value; setPicks(v); setError(null); }}>
              <option value="">{i === 0 ? 'Pick a golfer' : '— none —'}</option>
              {roster.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}{p.isSub ? ' (sub)' : ''}{busyPlayers.has(p.id) ? ' — already in a group' : ''}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="row wrap">
        <input placeholder="Sub's name" value={subName} onChange={(e) => setSubName(e.target.value)} style={{ maxWidth: 260 }} />
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy || !subName.trim()}
          onClick={async () => {
            const id = await run(() => api.addSub(league.id, subName));
            if (id) {
              setExtraNames((x) => (x.some((y) => y.id === id) || players.some((p) => p.id === id) ? x : [...x, { id, name: subName.trim() }]));
              setSubName('');
            }
          }}
        >
          Add a sub
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
      <div><button className="btn btn-primary" disabled={busy}>{busy ? 'Starting…' : 'Start scoring'}</button></div>
    </form>
  );
}
