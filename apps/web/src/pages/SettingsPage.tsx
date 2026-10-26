import { useState } from 'react';
import { CopyField, ErrorText, ProLock } from '../components/ui';
import { api } from '../lib/backend';
import type { DemoApi } from '../lib/demoApi';
import { useAction, useAsync, useAuth, useLeague } from '../lib/hooks';
import { isCommissioner, type Plan, type Role } from '../lib/types';
import { randomJoinCode } from '../lib/util';

export function SettingsPage() {
  const { league, reloadLeague } = useLeague();
  // Bumped when a join request is approved so the member list refreshes.
  const [membersVersion, setMembersVersion] = useState(0);
  if (!isCommissioner(league.role)) return <div className="page"><p className="muted">Only commissioners can change league settings.</p></div>;
  return (
    <div className="page stack">
      <LeagueName />
      <JoinCode />
      <JoinRequests onApproved={() => setMembersVersion((v) => v + 1)} />
      <Members version={membersVersion} />
      {api.mode === 'demo' && <DemoPlan onChanged={reloadLeague} />}
    </div>
  );
}

function LeagueName() {
  const { league, reloadLeague } = useLeague();
  const [name, setName] = useState(league.name);
  const { busy, error, setError, run } = useAction();
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim().length < 2) return setError('Enter a league name.');
        const ok = await run(async () => { await api.updateLeague(league.id, { name: name.trim() }); return true; });
        if (ok) reloadLeague();
      }}
    >
      <h2>League name</h2>
      <div className="row">
        <input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} />
        <button className="btn" disabled={busy || name.trim() === league.name}>Save</button>
      </div>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

function JoinCode() {
  const { league, reloadLeague } = useLeague();
  const { busy, error, run } = useAction();
  const setCode = async (code: string | null) => {
    const ok = await run(async () => { await api.updateLeague(league.id, { joinCode: code }); return true; });
    if (ok) reloadLeague();
  };
  return (
    <section className="card stack">
      <h2>League code</h2>
      <p className="small muted">Golfers can enter this code to ask to join. You approve each request below. For golfers already on your roster, an invite link from the Roster tab is quicker.</p>
      {league.joinCode ? (
        <>
          <div className="join-code" aria-label="League code">{league.joinCode}</div>
          <CopyField label="Message to send" value={`Join ${league.name} on GolfScoreHQ: go to ${window.location.origin}, sign in, and enter code ${league.joinCode}`} />
          <div className="row">
            <button className="btn btn-sm" disabled={busy} onClick={() => setCode(randomJoinCode())}>New code</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setCode(null)}>Turn off</button>
          </div>
        </>
      ) : (
        <div><button className="btn" disabled={busy} onClick={() => setCode(randomJoinCode())}>Create a code</button></div>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

function JoinRequests({ onApproved }: { onApproved: () => void }) {
  const { league } = useLeague();
  const reqs = useAsync(() => api.joinRequests(league.id), [league.id]);
  const { busy, error, run } = useAction();
  if (!reqs.data?.length) return null;
  return (
    <section className="card flush">
      <h2 className="pad">Requests to join <span className="badge badge-pro">{reqs.data.length}</span></h2>
      <ul className="list">
        {reqs.data.map((r) => (
          <li key={r.userId} className="list-row">
            <div className="grow">
              <strong>{r.name ?? r.email ?? 'Someone'}</strong>
              <div className="small muted">{[r.name ? r.email : null, r.message].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="row actions">
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { await run(() => api.decideJoinRequest(league.id, r.userId, true)); reqs.reload(); onApproved(); }}>Approve</button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => { await run(() => api.decideJoinRequest(league.id, r.userId, false)); reqs.reload(); }}>Decline</button>
            </div>
          </li>
        ))}
      </ul>
      <div className="pad"><ErrorText>{error}</ErrorText></div>
    </section>
  );
}

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'player', label: 'Golfer' },
  { value: 'scorer', label: 'Scorer' },
  { value: 'commissioner', label: 'Co-commissioner' },
];

function Members({ version }: { version: number }) {
  const { league } = useLeague();
  const { user } = useAuth();
  const members = useAsync(() => api.members(league.id), [league.id, version]);
  const { busy, error, run } = useAction();
  const canCoCommish = league.features.includes('co_commissioners');
  return (
    <section className="card flush">
      <div className="pad stack">
        <h2>Members</h2>
        <p className="small muted">People with an account in this league. Golfers who haven't joined yet are still on the roster and can be scored.</p>
      </div>
      <ul className="list">
        {members.data?.map((m) => (
          <li key={m.userId} className="list-row">
            <div className="grow">
              <strong>{m.playerName ?? 'Member without a roster spot'}</strong>
              {m.userId === user?.id && <span className="small muted"> (you)</span>}
            </div>
            {m.role === 'owner' ? (
              <span className="small muted">Owner</span>
            ) : (
              <select
                aria-label={`Role for ${m.playerName ?? 'member'}`}
                value={m.role}
                disabled={busy}
                onChange={async (e) => { await run(() => api.setMemberRole(league.id, m.userId, e.target.value as Role)); members.reload(); }}
              >
                {ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.value === 'commissioner' && !canCoCommish && m.role !== 'commissioner'}>
                    {o.label}{o.value === 'commissioner' && !canCoCommish ? ' (Pro)' : ''}
                  </option>
                ))}
              </select>
            )}
          </li>
        ))}
      </ul>
      <div className="pad stack">
        {!canCoCommish && <p className="small muted"><ProLock /> Co-commissioners come with Pro.</p>}
        <ErrorText>{error}</ErrorText>
      </div>
    </section>
  );
}

function DemoPlan({ onChanged }: { onChanged: () => void }) {
  const { league } = useLeague();
  return (
    <section className="card stack">
      <h2>Demo: switch plan</h2>
      <p className="small muted">Only in demo mode. See how the league behaves on each plan.</p>
      <div className="row wrap">
        {(['free', 'pro', 'club', 'pilot'] as Plan[]).map((p) => (
          <button key={p} className={`btn btn-sm ${league.plan === p ? 'btn-primary' : ''}`} onClick={async () => { await (api as DemoApi).setPlan(league.id, p); onChanged(); }}>
            {p[0]!.toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>
    </section>
  );
}
