import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ErrorText } from '../components/ui';
import { api } from '../lib/backend';
import type { DemoApi } from '../lib/demoApi';
import { demoLookFromSearch, seedDemoLeague, type DemoLook } from '../lib/demoSeed';
import { saveDemoLink } from '../lib/demoSite';

/**
 * golfscorehq.app/demo: builds the sample league in this browser, then opens it.
 * A link with ?course=… is a demo for one course: first pick its logo and
 * clubhouse photo from this device (the pictures never leave it).
 */
export function DemoPage() {
  const nav = useNavigate();
  const { search } = useLocation();
  const look = demoLookFromSearch(search);
  const personal = !!(look.course || look.league);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logo, setLogo] = useState<File | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const started = useRef(false);

  const build = (withLook: DemoLook) => {
    if (started.current) return;
    started.current = true;
    if (api.mode !== 'demo') {
      setError('This browser blocks the storage the demo needs (private browsing?). Try a normal window.');
      return;
    }
    saveDemoLink(search);
    setStep('Setting up the demo league…');
    seedDemoLeague(api as DemoApi, setStep, withLook)
      // Straight to the live leaderboard: tonight's groups are out on the course.
      .then((slug) => nav(`/l/${slug}/live`, { replace: true }))
      .catch((e: Error) => setError(`The demo couldn't start: ${e.message}`));
  };

  useEffect(() => {
    if (!personal) build(look);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (personal && !step && !error) {
    const name = look.course ?? look.league;
    return (
      <form className="page stack" onSubmit={(e) => { e.preventDefault(); build({ ...look, logo, photo }); }}>
        <h1>Demo for {name}</h1>
        <p>Pick the course's logo and a clubhouse photo from this device. Both are optional, and they stay on this device.</p>
        <label className="card stack">
          <strong>Course logo</strong>
          <input type="file" accept="image/*" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} />
        </label>
        <label className="card stack">
          <strong>Clubhouse or course photo</strong>
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
        <button className="btn btn-primary">Build the demo</button>
      </form>
    );
  }

  return (
    <div className="page stack">
      <h1>GolfScoreHQ demo</h1>
      <p>A made-up league: 16 golfers, six weeks played, and tonight's groups out on the course.</p>
      {error ? <ErrorText>{error}</ErrorText> : <p className="muted" aria-live="polite">{step}</p>}
    </div>
  );
}
