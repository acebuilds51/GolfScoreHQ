import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, demoSite } from '../lib/backend';
import type { DemoApi } from '../lib/demoApi';
import { demoLink, demoTvToken, setDemoSite } from '../lib/demoSite';
import { useAuth } from '../lib/hooks';

/** The public demo's bar: made-up data, the TV screen, start over, and the way back to the real site. */
function DemoSiteBar() {
  const tv = demoTvToken();
  return (
    <div className="demo-bar">
      Demo league with made-up golfers. Nothing you do here is saved anywhere.{' '}
      {tv && <a href={`/tv/${tv}`} target="_blank" rel="noreferrer">Open the clubhouse TV</a>}
      {tv && ' · '}
      <a href={demoLink()}>Start over</a>
      {' · '}
      <a
        href="/"
        onClick={(e) => {
          e.preventDefault();
          (api as DemoApi).reset();
          setDemoSite(false);
          location.href = '/';
        }}
      >
        Exit demo
      </a>
    </div>
  );
}

/** From inside a league, the Help page knows which league a question is about. */
const slugFrom = (path: string) => {
  const slug = path.match(/^\/l\/([^/]+)/)?.[1];
  return slug ? `?from=${encodeURIComponent(slug)}` : '';
};

export function Header() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  return (
    <>
      {demoSite ? <DemoSiteBar /> : api.mode === 'demo' && <div className="demo-bar">Demo mode — everything stays in this browser. No emails are sent.</div>}
      <header className="topbar">
        <Link to={user ? '/leagues' : '/'} className="brand">
          <img className="brand-icon" src="/icon-192.png" alt="" width={36} height={36} />
          <span>GolfScoreHQ</span>
        </Link>
        <div className="topbar-right">
          <Link className="btn btn-ghost btn-sm" to={`/help${slugFrom(pathname)}`}>Help</Link>
          {user && (<>
            <span className="muted small hide-narrow">{user.email}</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                await api.signOut();
                nav('/');
              }}
            >
              Sign out
            </button>
          </>)}
        </div>
      </header>
    </>
  );
}
