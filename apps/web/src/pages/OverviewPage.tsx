import { Link } from 'react-router-dom';
import { api } from '../lib/backend';
import { useAction, useAsync, useAuth, useLeague } from '../lib/hooks';
import { fmtDate } from '../lib/scoring';
import { isCommissioner, type LeagueEvent, type Player, type RsvpStatus } from '../lib/types';
import { RsvpButtons } from './WhosPlaying';

export function OverviewPage() {
  const { league } = useLeague();
  const data = useAsync(async () => {
    const [players, courses, members, seasons] = await Promise.all([api.players(league.id), api.courses(league.id), api.members(league.id), api.seasons(league.id)]);
    const events = seasons[0] ? await api.events(seasons[0].id) : [];
    const nextWeek = events.find((e) => e.status === 'scheduled') ?? null;
    return { players, courses, members, nextWeek };
  }, [league.id]);

  if (!data.data) return <div className="page muted">Loading…</div>;
  const { players, courses, members, nextWeek } = data.data;
  const active = players.filter((p) => p.active);
  const regulars = active.filter((p) => !p.isSub).length;
  const subs = active.length - regulars;
  const joined = active.filter((p) => p.userId).length;
  const commish = isCommissioner(league.role);

  const steps = [
    { done: courses.some((c) => c.leagueId === league.id), label: 'Add your course', to: 'courses' },
    { done: active.length > 0, label: 'Add your golfers', to: 'roster' },
    { done: joined > 0 || members.length > 1, label: 'Invite golfers to join', to: 'roster' },
    { done: !!league.joinCode, label: 'Set a league code', to: 'settings' },
  ];

  return (
    <div className="page stack">
      {nextWeek && league.features.includes('rsvp') && <NextWeekRsvp event={nextWeek} players={players} />}
      <div className="stats">
        <div className="stat"><span>Golfers</span><strong>{regulars}</strong></div>
        <div className="stat"><span>Subs</span><strong>{subs}</strong></div>
        <div className="stat"><span>Joined the app</span><strong>{joined}</strong></div>
        <div className="stat"><span>Courses</span><strong>{courses.length}</strong></div>
      </div>

      {commish && steps.some((s) => !s.done) && (
        <section className="card">
          <h2>Set up your league</h2>
          <ol className="checklist">
            {steps.map((s) => (
              <li key={s.label} className={s.done ? 'done' : ''}>
                <span className="check" aria-hidden="true">{s.done ? '✓' : ''}</span>
                {s.done ? s.label : <Link to={s.to}>{s.label}</Link>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="card stack">
        <h2>Play</h2>
        <p className="muted">Scoring happens on the <Link to="play">Play</Link> tab: pick the week, start your group, and enter scores hole by hole.</p>
      </section>
      {league.features.includes('weekly_recap') && <RecapPref players={players} />}
    </div>
  );
}

/** The signed-in golfer's own "email me the weekly recap" switch. */
function RecapPref({ players }: { players: Player[] }) {
  const { league } = useLeague();
  const { user } = useAuth();
  const mine = players.find((p) => p.active && p.userId && p.userId === user?.id);
  const pref = useAsync(() => (mine ? api.recapPref(mine.id) : Promise.resolve(true)), [mine?.id]);
  const { busy, error, run } = useAction();
  if (!mine || pref.data === undefined) return null;
  return (
    <section className="card stack">
      <label className="row">
        <input
          type="checkbox"
          checked={pref.data}
          disabled={busy}
          onChange={async (e) => { const on = e.target.checked; await run(() => api.setRecapPref(league.id, mine.id, on)); pref.reload(); }}
        />
        Email me the weekly recap
      </label>
      <p className="small muted">After each week is final: results, skins, highlights and what you won or owe.</p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

/** "Are you playing week N?" for the signed-in golfer's own roster spot. */
function NextWeekRsvp({ event, players }: { event: LeagueEvent; players: Player[] }) {
  const { league } = useLeague();
  const { user } = useAuth();
  const mine = players.find((p) => p.active && p.userId && p.userId === user?.id);
  const rsvps = useAsync(() => api.rsvps(event.id), [event.id]);
  const { busy, error, run } = useAction();
  if (!mine) return null;
  const value = rsvps.data?.[mine.id] as RsvpStatus | undefined;
  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>Week {event.weekNumber}{event.eventDate ? ` · ${fmtDate(event.eventDate)}` : ''}</h2>
        <Link className="small" to={`week/${event.id}`}>See who's playing →</Link>
      </div>
      <div className="row wrap">
        <span>{value ? 'Your reply:' : 'Are you playing?'}</span>
        <RsvpButtons value={value} busy={busy} onPick={async (s) => { await run(() => api.setRsvp(league.id, event.id, mine.id, s)); rsvps.reload(); }} />
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
