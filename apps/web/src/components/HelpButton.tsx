import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AskChat } from './AskChat';

/** Screens where a floating button would get in the way: the scorecard's + and − buttons (real, or pretend in a lesson), and the Help page, which has its own Ask box. */
const HIDDEN = [/^\/l\/[^/]+\/round\//, /^\/help(\/|$)/, /^\/lessons\/[^/]+/];

/**
 * The ? in the corner of every screen, like Upset Special's: opens "Ask about
 * GolfScoreHQ" as a panel over whatever page you're on. Closing it keeps the
 * conversation until you leave the app.
 */
export function HelpButton() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const slug = /^\/l\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const hidden = HIDDEN.some((re) => re.test(pathname));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // A link inside the panel (Help page, guide) moves on: close it.
  useEffect(() => setOpen(false), [pathname]);

  if (hidden && !open) return null;
  return (
    <>
      {!hidden && (
        <button type="button" className={`help-fab${slug ? ' in-league' : ''}`} aria-label="Ask a question about GolfScoreHQ" aria-expanded={open}
          onClick={() => { setOpen(true); setOpened(true); }}>
          ?
        </button>
      )}
      {opened && (
        <div className="help-sheet-backdrop" hidden={!open} onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="help-sheet stack" role="dialog" aria-modal="true" aria-labelledby="help-sheet-title">
            <div className="row between">
              <div>
                <h2 id="help-sheet-title">Ask about GolfScoreHQ</h2>
                <p className="small muted">Scoring, settling up, the tee sheet, your league's settings: ask in your own words.</p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm help-sheet-close" aria-label="Close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <AskChat leagueSlug={slug} autoFocus={open} />
            <p className="small muted help-sheet-links">
              <Link to={`/help${slug ? `?from=${encodeURIComponent(slug)}` : ''}`}>Help page</Link>
              {' · '}
              <Link to="/guide">Commissioner's guide</Link>
              {' · '}
              <Link to="/guide?for=golfers">Golfer's guide</Link>
              {' · '}
              <Link to={`/feedback${slug ? `?from=${encodeURIComponent(slug)}` : ''}`} state={{ back: pathname }}>Send us an idea</Link>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
