import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { reportProblem } from '../lib/diagnostics';
import { useLeague } from '../lib/hooks';
import { useInstallPrompt } from '../lib/install';
import { isCommissioner } from '../lib/types';

/** Phones: everything that isn't on the bottom bar. */
export function MorePage() {
  const { league } = useLeague();
  const install = useInstallPrompt();
  const items: { to: string; label: string; icon: IconName }[] = [
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
      <nav className="card flush" aria-label="Help">
        <ul className="list more-list">
          <li>
            <Link to={`/help?from=${encodeURIComponent(league.slug)}`}>
              <Icon name="help" />
              <span className="grow">Help and questions</span>
              <Icon name="chevron" size={18} />
            </Link>
          </li>
          <li>
            <Link to={isCommissioner(league.role) ? '/guide' : '/guide?for=golfers'}>
              <Icon name="book" />
              <span className="grow">{isCommissioner(league.role) ? "Commissioner's guide" : "Golfer's guide"}</span>
              <Icon name="chevron" size={18} />
            </Link>
          </li>
        </ul>
      </nav>
      <ReportProblem />
    </div>
  );
}

/** Anyone can tell us something isn't working; it lands on the staff health page and in the daily email. */
function ReportProblem() {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  if (sent) return <p className="small good">Thanks, we got it. We'll look into it.</p>;
  if (!open) return <p className="small muted">Something not working? <button type="button" className="linkish" onClick={() => setOpen(true)}>Report a problem</button></p>;
  return (
    <section className="card stack">
      <h2>Report a problem</h2>
      <textarea rows={4} maxLength={2000} value={note} autoFocus placeholder="What happened, and what were you trying to do? e.g. Week 3 scores won't save for our group." onChange={(e) => setNote(e.target.value)} />
      <p className="small muted">Which page you're on and your phone type are sent with it, to help us find the problem.</p>
      <div className="row wrap">
        <button className="btn btn-primary" disabled={note.trim().length < 5} onClick={() => { reportProblem('report', note.trim().slice(0, 200), note.trim()); setSent(true); }}>Send</button>
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </section>
  );
}
