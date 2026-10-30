import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState, ErrorText, PlanBadge } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync } from '../lib/hooks';
import { cleanSlugInput, SLUG_RE, slugify } from '../lib/util';
import { ClubSection } from './ClubSection';

const ROLE_LABEL = { owner: 'Commissioner (owner)', commissioner: 'Commissioner', scorer: 'Scorer', player: 'Golfer' } as const;

export function LeaguesPage() {
  const leagues = useAsync(() => api.myLeagues(), []);
  const staff = useAsync(() => api.isStaff(), []);
  return (
    <div className="page">
      <div className="row between wrap">
        <h1>Your leagues</h1>
        {staff.data && <Link className="btn btn-sm" to="/staff">Staff: pilot codes and setup requests</Link>}
      </div>
      {leagues.error && <ErrorText>{leagues.error}</ErrorText>}
      {leagues.data && leagues.data.length === 0 && (
        <EmptyState title="Start or join a league">
          <p className="muted">Commissioners create a league below. Golfers join with an invite link or the league's code.</p>
        </EmptyState>
      )}
      <div className="grid">
        {leagues.data?.map((l) => (
          <Link key={l.id} to={`/l/${l.slug}`} className="card card-link">
            <div className="row between">
              <h3>{l.name}</h3>
              <PlanBadge plan={l.plan} />
            </div>
            <p className="small muted">{ROLE_LABEL[l.role]}</p>
          </Link>
        ))}
      </div>
      <div className="grid two">
        <CreateLeague />
        <JoinWithCode onJoined={leagues.reload} />
      </div>
      {leagues.data && <ClubSection leagues={leagues.data} onChanged={leagues.reload} />}
    </div>
  );
}

function CreateLeague() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const { busy, error, setError, run } = useAction();
  const effectiveSlug = slugEdited ? slug : slugify(name);

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim().length < 2) return setError('Enter a league name.');
        const finalSlug = cleanSlugInput(effectiveSlug);
        if (!SLUG_RE.test(finalSlug)) return setError('League link: use 2 to 41 letters, numbers or dashes, like shepherds-hollow.');
        const id = await run(() => api.createLeague(name.trim(), finalSlug));
        // Straight into the setup questions; they can skip any of it.
        if (id) nav(`/l/${finalSlug}/start`);
      }}
    >
      <h2>Create a league</h2>
      <label>
        League name
        <input placeholder="Oak Creek Thursday League" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} />
      </label>
      <label>
        League link
        <div className="prefixed">
          <span>{window.location.host}/l/</span>
          <input
            value={effectiveSlug}
            onChange={(e) => { setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-')); setSlugEdited(true); setError(null); }}
            onBlur={() => slugEdited && setSlug(cleanSlugInput(slug))}
          />
        </div>
        <span className="small muted">Your league's page on GolfScoreHQ. It's filled in from the name, so you can usually leave it.</span>
      </label>
      <ErrorText>{error}</ErrorText>
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create league'}</button>
    </form>
  );
}

function JoinWithCode({ onJoined }: { onJoined: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, setError, run } = useAction();
  if (done) {
    return (
      <div className="card stack">
        <h2>Request sent</h2>
        <p className="muted">Your commissioner will approve it. The league shows up here once they do.</p>
        <button className="btn btn-ghost btn-sm" onClick={() => { setDone(false); setCode(''); onJoined(); }}>Join another league</button>
      </div>
    );
  }
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!/^[A-Za-z0-9]{6}$/.test(code.trim())) return setError('League codes are 6 letters and numbers.');
        if (!name.trim()) return setError('Enter your name so the commissioner knows who you are.');
        const ok = await run(async () => { await api.requestToJoin(code, name); return true; });
        if (ok) setDone(true);
      }}
    >
      <h2>Join with a code</h2>
      <label>
        League code
        <input className="code-input" maxLength={6} placeholder="K7Q2MX" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }} />
      </label>
      <label>
        Your name
        <input autoComplete="name" placeholder="Pat Jones" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} />
      </label>
      <ErrorText>{error}</ErrorText>
      <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Ask to join'}</button>
    </form>
  );
}
