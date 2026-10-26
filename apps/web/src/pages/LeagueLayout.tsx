import { NavLink, Outlet, useParams } from 'react-router-dom';
import { ErrorText, PlanBadge } from '../components/ui';
import { api } from '../lib/backend';
import { LeagueContext, useAsync } from '../lib/hooks';
import { isCommissioner } from '../lib/types';

export function LeagueLayout() {
  const { slug = '' } = useParams();
  const league = useAsync(() => api.league(slug), [slug]);

  if (league.loading && !league.data) return <div className="page muted">Loading…</div>;
  if (league.error) return <div className="page"><ErrorText>{league.error}</ErrorText></div>;
  if (!league.data) {
    return (
      <div className="page">
        <h1>League not found</h1>
        <p className="muted">Either it doesn't exist or you're not a member yet. Ask the commissioner for an invite link.</p>
      </div>
    );
  }
  const l = league.data;
  const commish = isCommissioner(l.role);
  return (
    <LeagueContext.Provider value={{ league: l, reloadLeague: league.reload }}>
      <div className="league-head">
        <div className="page row between wrap">
          <div>
            <h1>{l.name}</h1>
            <div className="row small muted">
              <PlanBadge plan={l.effectivePlan} />
              {l.effectivePlan !== l.plan && <span>Plan lapsed — Pro features are paused</span>}
            </div>
          </div>
        </div>
        <nav className="tabs page" aria-label="League">
          <NavLink end to="">Overview</NavLink>
          <NavLink to="play" className={({ isActive }) => (isActive || /\/(week|round)\//.test(window.location.pathname) ? 'active' : '')}>Play</NavLink>
          <NavLink to="roster">Roster</NavLink>
          <NavLink to="courses">Courses</NavLink>
          {commish && <NavLink to="settings">Settings</NavLink>}
        </nav>
      </div>
      <Outlet />
    </LeagueContext.Provider>
  );
}
