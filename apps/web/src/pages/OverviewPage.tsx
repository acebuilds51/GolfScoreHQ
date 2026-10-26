import { Link } from 'react-router-dom';
import { api } from '../lib/backend';
import { useAsync, useLeague } from '../lib/hooks';
import { isCommissioner } from '../lib/types';

export function OverviewPage() {
  const { league } = useLeague();
  const data = useAsync(async () => {
    const [players, courses, members] = await Promise.all([api.players(league.id), api.courses(league.id), api.members(league.id)]);
    return { players, courses, members };
  }, [league.id]);

  if (!data.data) return <div className="page muted">Loading…</div>;
  const { players, courses, members } = data.data;
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

      <section className="card">
        <h2>Coming next</h2>
        <p className="muted">Scoring, the live leaderboard and standings are the next screens being built. Your roster and course carry straight over.</p>
      </section>
    </div>
  );
}
