import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { useLeague } from '../lib/hooks';
import { useInstallPrompt } from '../lib/install';
import { isCommissioner } from '../lib/types';

/** Phones: everything that isn't on the bottom bar. */
export function MorePage() {
  const { league } = useLeague();
  const install = useInstallPrompt();
  const items: { to: string; label: string; icon: IconName }[] = [
    { to: '../standings', label: 'Season standings', icon: 'trophy' },
    { to: '../awards', label: 'Season awards and stats', icon: 'trophy' },
    { to: '../roster', label: 'Roster', icon: 'users' },
    { to: '../courses', label: 'Courses', icon: 'map' },
    ...(isCommissioner(league.role) ? [
      { to: '../settings', label: 'Settings', icon: 'settings' as const },
      { to: '../setup', label: 'We set up your league', icon: 'users' as const },
      { to: '../import', label: 'Import past rounds', icon: 'download' as const },
    ] : []),
  ];
  return (
    <div className="page stack">
      <nav className="card flush" aria-label="More">
        <ul className="list more-list">
          {items.map((i) => (
            <li key={i.to}>
              <Link to={i.to}>
                <Icon name={i.icon} />
                <span className="grow">{i.label}</span>
                <Icon name="chevron" size={18} />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {install.kind !== 'installed' && (
        <section className="card stack">
          <div className="row"><Icon name="install" /><h2>Put GolfScoreHQ on your home screen</h2></div>
          {install.kind === 'prompt' ? (
            <>
              <p className="small muted">Opens full screen like any other app, one tap from your home screen.</p>
              <div><button className="btn btn-primary" onClick={install.prompt}>Add to home screen</button></div>
            </>
          ) : install.kind === 'ios' ? (
            <p className="small muted">In Safari, tap the Share button, then <strong>Add to Home Screen</strong>.</p>
          ) : (
            <p className="small muted">In your phone's browser menu, choose <strong>Add to Home Screen</strong> or <strong>Install app</strong>.</p>
          )}
        </section>
      )}
    </div>
  );
}
