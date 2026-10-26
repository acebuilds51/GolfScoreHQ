import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/backend';
import { useAuth } from '../lib/hooks';

export function Header() {
  const { user } = useAuth();
  const nav = useNavigate();
  return (
    <>
      {api.mode === 'demo' && <div className="demo-bar">Demo mode — everything stays in this browser. No emails are sent.</div>}
      <header className="topbar">
        <Link to={user ? '/leagues' : '/'} className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>GolfScoreHQ</span>
        </Link>
        {user && (
          <div className="topbar-right">
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
          </div>
        )}
      </header>
    </>
  );
}
