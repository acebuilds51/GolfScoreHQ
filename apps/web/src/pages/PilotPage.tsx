import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ErrorText, PageSkeleton } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync, useAuth } from '../lib/hooks';
import { PRICE } from '../lib/plans';
import { cleanSlugInput, SLUG_RE, slugify } from '../lib/util';
import { SignInForm } from './SignInPage';

const PERKS = [
  'Every Pro feature, free for your 2027 season: skins, closest to the pin and match money settled for you, every format, the tee sheet with captains and a partner and match finder, RSVPs and reminders, weekly recap emails, awards and Clubhouse TV.',
  'Unlimited golfers. Scores on every phone, a live leaderboard and standings everyone can see.',
  "Send us your spreadsheet and we'll set the league up for you.",
  `No card needed. After 2027, Pro is ${PRICE.pro} a year per league, with a thank-you discount for pilot leagues.`,
];

const STATUS_TEXT = {
  used: 'This pilot link has already been used. If that wasn\'t you, reply to whoever sent it.',
  ended: 'This pilot link has ended. Reply to whoever sent it for a new one.',
  invalid: "This pilot link isn't right. Check that you copied all of it.",
} as const;

/** golfscorehq.app/pilot/<code>: what the pilot is, then start a league on it (or switch a free one over). */
export function PilotPage() {
  const { code = '' } = useParams();
  const { user, loading } = useAuth();
  const status = useAsync(() => api.pilotCodeStatus(code), [code]);
  const leagues = useAsync(async () => (user ? api.myLeagues() : []), [user?.id]);
  const nav = useNavigate();
  const { busy, error, run } = useAction();

  if (loading || status.loading) return <PageSkeleton />;
  const free = (leagues.data ?? []).filter((l) => l.role === 'owner' && l.plan === 'free');

  return (
    <div className="page narrow stack">
      <div>
        <p className="small muted">GolfScoreHQ · 2027 pilot</p>
        <h1>You're invited to the GolfScoreHQ pilot</h1>
      </div>
      <ul className="ticks">{PERKS.map((p) => <li key={p}>{p}</li>)}</ul>

      {status.data !== 'ok' ? (
        <p className="warn">{STATUS_TEXT[status.data ?? 'invalid']}</p>
      ) : !user ? (
        <section className="card stack">
          <h2>First, sign in</h2>
          <p className="muted">With your email: we send you a code, no password. Then you'll name your league.</p>
          <SignInForm redirectTo={window.location.href} cta="Email me a code" />
        </section>
      ) : (
        <>
          <StartPilotLeague code={code} />
          {free.length > 0 && (
            <section className="card stack">
              <h2>Or use it for a league you already run</h2>
              {free.map((l) => (
                <div key={l.id} className="row between wrap">
                  <strong>{l.name}</strong>
                  <button className="btn btn-sm" disabled={busy}
                    onClick={async () => { const ok = await run(async () => { await api.redeemPilotCode(code, l.id); return true; }); if (ok) nav(`/l/${l.slug}`); }}>
                    Make it a pilot league
                  </button>
                </div>
              ))}
              <ErrorText>{error}</ErrorText>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function StartPilotLeague({ code }: { code: string }) {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const { busy, error, setError, run } = useAction();
  const effectiveSlug = slugEdited ? slug : slugify(name);
  return (
    <form className="card stack" onSubmit={async (e) => {
      e.preventDefault();
      if (name.trim().length < 2) return setError('Enter your league\'s name.');
      const finalSlug = cleanSlugInput(effectiveSlug);
      if (!SLUG_RE.test(finalSlug)) return setError('League link: use 2 to 41 letters, numbers or dashes, like shepherds-hollow.');
      const id = await run(() => api.createPilotLeague(code, name.trim(), finalSlug));
      if (id) nav(`/l/${finalSlug}/start`);
    }}>
      <h2>Start your pilot league</h2>
      <label>League name<input placeholder="Oak Creek Thursday League" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} /></label>
      <label>
        League link
        <div className="prefixed">
          <span>{window.location.host}/l/</span>
          <input value={effectiveSlug}
            onChange={(e) => { setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-')); setSlugEdited(true); setError(null); }}
            onBlur={() => slugEdited && setSlug(cleanSlugInput(slug))} />
        </div>
      </label>
      <ErrorText>{error}</ErrorText>
      <div><button className="btn btn-primary" disabled={busy}>{busy ? 'Starting…' : 'Start my pilot league'}</button></div>
    </form>
  );
}
