import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { NotificationPrompt } from '../components/PhoneNotifications';
import { ErrorText, PlanBadge, PageSkeleton } from '../components/ui';
import { api } from '../lib/backend';
import { brandBanner, brandLogo, brandStyle } from '../lib/brand';
import { LeagueContext, useAsync } from '../lib/hooks';
import { isCommissioner } from '../lib/types';

/** Phones: five big labeled targets at the bottom, where a thumb can reach with a glove on. */
function BottomBar() {
  const path = useLocation().pathname;
  const section = /\/(play|week|round)(\/|$)/.test(path) ? 'play'
    : /\/live(\/|$)/.test(path) ? 'live'
    : /\/(standings|awards|player)(\/|$)/.test(path) ? 'standings'
    : /\/(more|roster|courses|settings|import|setup)(\/|$)/.test(path) ? 'more'
    : 'home';
  const tabs: { key: string; to: string; label: string; icon: IconName }[] = [
    { key: 'home', to: '', label: 'Home', icon: 'home' },
    { key: 'play', to: 'play', label: 'Play', icon: 'flag' },
    { key: 'live', to: 'live', label: 'Live', icon: 'podium' },
    { key: 'standings', to: 'standings', label: 'Standings', icon: 'trophy' },
    { key: 'more', to: 'more', label: 'More', icon: 'dots' },
  ];
  return (
    <nav className="bottom-bar" aria-label="League">
      {tabs.map((t) => (
        <Link key={t.key} to={t.to} className={section === t.key ? 'on' : undefined} aria-current={section === t.key ? 'page' : undefined}>
          <Icon name={t.icon} size={24} />
          <span>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function LeagueLayout() {
  const { slug = '' } = useParams();
  const league = useAsync(() => api.league(slug), [slug]);

  if (league.loading && !league.data) return <PageSkeleton />;
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
  const logo = brandLogo(l);
  const banner = brandBanner(l);
  return (
    <LeagueContext.Provider value={{ league: l, reloadLeague: league.reload }}>
      {/* The league's colors (Pro) apply to everything inside its pages. */}
      <div style={brandStyle(l)}>
        <div className="league-head">
          <div
            className={`league-band${banner ? ' has-banner' : ''}`}
            style={banner ? { backgroundImage: `linear-gradient(rgba(0,0,0,0.12), rgba(0,0,0,0.6)), url("${banner}")` } : undefined}
          >
            <div className="page row between wrap">
              <div className="league-title">
                {logo && <img className="league-logo" src={logo} alt="" />}
                <div>
                  <h1>{l.name}</h1>
                  <div className="row small muted">
                    <PlanBadge plan={l.effectivePlan} />
                    {l.effectivePlan !== l.plan && <span>Plan lapsed — Pro features are paused</span>}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <nav className="tabs page top-tabs" aria-label="League">
            <NavLink end to="">Overview</NavLink>
            <NavLink to="play" className={({ isActive }) => (isActive || /\/(week|round)\//.test(window.location.pathname) ? 'active' : '')}>Play</NavLink>
            <NavLink to="live">Live</NavLink>
            <NavLink to="standings">Standings</NavLink>
            <NavLink to="awards">Awards</NavLink>
            <NavLink to="roster">Roster</NavLink>
            <NavLink to="courses">Courses</NavLink>
            {commish && <NavLink to="settings">Settings</NavLink>}
            {/* Everything else (import, setup help, install) lives on the More page, same as the phone's bottom bar. */}
            <NavLink to="more" className={({ isActive }) => (isActive || /\/(import|setup|player)\b/.test(window.location.pathname) ? 'active' : '')}>More</NavLink>
          </nav>
        </div>
        <NotificationPrompt moreLink={`/l/${l.slug}/more`} />
        <Outlet />
        <BottomBar />
      </div>
    </LeagueContext.Provider>
  );
}
