import { useState } from 'react';
import { CopyField, ErrorText, ProLock } from '../components/ui';
import { api } from '../lib/backend';
import type { DemoApi } from '../lib/demoApi';
import { useAction, useAsync, useAuth, useLeague } from '../lib/hooks';
import { isCommissioner, type PaymentHandles, type Plan, type Role, type TvDisplay, type TvPanel, type TvSettings } from '../lib/types';
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
      <PaymentLinks />
      <ClubhouseTv />
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

/** Venmo / PayPal / Zelle handles. Shown to golfers who owe money in the recap email; the app never moves money. */
function PaymentLinks() {
  const { league } = useLeague();
  const allowed = league.features.includes('payments');
  const saved = useAsync(() => api.paymentHandles(league.id), [league.id]);
  const [draft, setDraft] = useState<PaymentHandles | null>(null);
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  const h = draft ?? saved.data ?? { venmo: null, paypalMe: null, zelle: null };
  const set = (k: keyof PaymentHandles) => (e: React.ChangeEvent<HTMLInputElement>) => { setDraft({ ...h, [k]: e.target.value }); setDone(false); };
  const clean = (v: string | null) => v?.trim() || null;

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const next = {
          venmo: clean(h.venmo)?.replace(/^@?/, '@') ?? null,
          paypalMe: clean(h.paypalMe)?.replace(/^(https?:\/\/)?(www\.)?paypal\.me\//i, '').replace(/\/.*$/, '') ?? null,
          zelle: clean(h.zelle),
        };
        const ok = await run(async () => { await api.savePaymentHandles(league.id, next); return true; });
        if (ok) { setDraft(null); setDone(true); saved.reload(); }
      }}
    >
      <div className="row between">
        <h2>How golfers pay you</h2>
        {!allowed && <ProLock />}
      </div>
      <p className="small muted">
        Golfers who owe money get a tap-to-pay link in their weekly recap email, with the amount filled in. Money goes straight to you; GolfScoreHQ never holds it. Leave any of these blank.
      </p>
      <label>Venmo username<input value={h.venmo ?? ''} onChange={set('venmo')} placeholder="@your-venmo" disabled={!allowed} /></label>
      <label>PayPal.me name<input value={h.paypalMe ?? ''} onChange={set('paypalMe')} placeholder="yourname (from paypal.me/yourname)" disabled={!allowed} /></label>
      <label>Zelle email or phone<input value={h.zelle ?? ''} onChange={set('zelle')} placeholder="you@example.com or 248-555-0100" disabled={!allowed} /></label>
      <div className="row">
        <button className="btn" disabled={!allowed || busy || !draft}>Save</button>
        {done && <span className="small good">Saved ✓</span>}
      </div>
      <ErrorText>{error ?? saved.error}</ErrorText>
    </form>
  );
}

const TV_PANELS:{ key: TvPanel; label: string }[] = [
  { key: 'live', label: 'Leaderboard' }, { key: 'matches', label: 'Matches' }, { key: 'skins', label: 'Skins' },
  { key: 'ctp', label: 'Closest to the pin' }, { key: 'highlights', label: 'Highlights' }, { key: 'standings', label: 'Season standings' },
];
const DEFAULT_TV: TvSettings = { hideMoney: true, secondsPerPanel: 15, panels: TV_PANELS.map((p) => p.key) };

function ClubhouseTv() {
  const { league } = useLeague();
  const allowed = league.features.includes('tv_mode');
  const displays = useAsync(() => (allowed ? api.tvDisplays(league.id) : Promise.resolve([])), [league.id, allowed]);
  const [newLink, setNewLink] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  return (
    <section className="card stack">
      <div className="row between">
        <h2>Clubhouse TV</h2>
        {!allowed && <ProLock />}
      </div>
      <p className="small muted">
        Put the live leaderboard on a TV at the course. Open the link on a smart TV's browser, a Fire Stick, a Chromecast or a laptop plugged into the TV. No sign-in needed on the TV; the link only shows this league's scores.
      </p>
      {allowed && (
        <>
          {newLink && (
            <div className="subcard stack">
              <strong>Your new TV link</strong>
              <p className="small muted">Copy it now: for security it's only shown once. You can always make a new one.</p>
              <CopyField value={newLink} />
              <div><a className="btn btn-sm" href={newLink} target="_blank" rel="noreferrer">Open it here</a></div>
            </div>
          )}
          {displays.data?.map((d) => (
            <TvDisplayEditor key={d.id} display={d} onChanged={displays.reload} />
          ))}
          <div>
            <button
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={async () => {
                const token = await run(() => api.createTvDisplay(league.id, displays.data?.length ? `Clubhouse TV ${displays.data.length + 1}` : 'Clubhouse TV', DEFAULT_TV));
                if (token) { setNewLink(`${window.location.origin}/tv/${token}`); displays.reload(); }
              }}
            >
              Create a TV link
            </button>
          </div>
        </>
      )}
      <ErrorText>{error ?? displays.error}</ErrorText>
    </section>
  );
}

function TvDisplayEditor({ display, onChanged }: { display: TvDisplay; onChanged: () => void }) {
  const { busy, error, run } = useAction();
  const save = async (settings: TvSettings) => { await run(() => api.updateTvDisplay(display.id, { settings })); onChanged(); };
  const s = display.settings;
  return (
    <div className="subcard stack">
      <div className="row between wrap">
        <strong>{display.name}</strong>
        <button
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm(`Turn off ${display.name}? Any TV showing it stops updating.`)) return;
            await run(() => api.revokeTvDisplay(display.id));
            onChanged();
          }}
        >
          Turn off link
        </button>
      </div>
      <label className="check-row"><input type="checkbox" checked={s.hideMoney} disabled={busy} onChange={(e) => save({ ...s, hideMoney: e.target.checked })} /> Hide dollar amounts</label>
      <label className="inline">
        Seconds per screen
        <select value={s.secondsPerPanel} disabled={busy} onChange={(e) => save({ ...s, secondsPerPanel: Number(e.target.value) })}>
          {[8, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <div className="row wrap">
        {TV_PANELS.map((p) => (
          <label key={p.key} className="check-row">
            <input
              type="checkbox"
              checked={s.panels.includes(p.key)}
              disabled={busy || (s.panels.length === 1 && s.panels.includes(p.key))}
              onChange={(e) => save({ ...s, panels: TV_PANELS.map((x) => x.key).filter((k) => (k === p.key ? e.target.checked : s.panels.includes(k))) })}
            />
            {p.label}
          </label>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
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
