import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorText } from '../components/ui';
import { api } from '../lib/backend';
import type { DemoApi } from '../lib/demoApi';
import { seedDemoLeague } from '../lib/demoSeed';

/** golfscorehq.app/demo: builds the sample league in this browser, then opens it. */
export function DemoPage() {
  const nav = useNavigate();
  const [step, setStep] = useState('Setting up the demo league…');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (api.mode !== 'demo') {
      setError("This browser blocks the storage the demo needs (private browsing?). Try a normal window.");
      return;
    }
    seedDemoLeague(api as DemoApi, setStep)
      // Straight to the live leaderboard: tonight's groups are out on the course.
      .then((slug) => nav(`/l/${slug}/live`, { replace: true }))
      .catch((e: Error) => setError(`The demo couldn't start: ${e.message}`));
  }, [nav]);

  return (
    <div className="page stack">
      <h1>GolfScoreHQ demo</h1>
      <p>A made-up Thursday league: 16 golfers, six weeks played, and tonight's groups out on the course.</p>
      {error ? <ErrorText>{error}</ErrorText> : <p className="muted" aria-live="polite">{step}</p>}
    </div>
  );
}
