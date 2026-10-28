import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CopyField, ErrorText, PageSkeleton } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync } from '../lib/hooks';
import type { SetupStatus, StaffSetupRequest } from '../lib/types';
import type { ErrorGroup } from '../lib/api';
import { capacityLines, WARN_AT } from '../../../../supabase/functions/health-report/report';
import { FileLinks, NoRequests, SETUP_STATUS, SETUP_WANTS } from './SetupServicePage';

/** GolfScoreHQ staff: every "We set up your league" request. */
export function StaffPage() {
  const staff = useAsync(() => api.isStaff(), []);
  const queue = useAsync(async () => (staff.data ? api.staffSetupQueue() : []), [staff.data]);
  const [showDone, setShowDone] = useState(false);

  if (staff.loading && staff.data === undefined) return <PageSkeleton />;
  if (!staff.data) return <div className="page"><h1>Page not found</h1></div>;
  if (queue.error) return <div className="page"><ErrorText>{queue.error}</ErrorText></div>;
  const all = queue.data ?? [];
  const shown = all.filter((r) => showDone || r.status !== 'done');

  return (
    <div className="page stack">
      <Health />
      <PilotCodes />
      <div className="row between wrap">
        <div>
          <Link to="/leagues" className="small">← Your leagues</Link>
          <h2>Setup requests</h2>
          <p className="small muted">{all.filter((r) => r.status !== 'done').length} open · {all.filter((r) => r.status === 'done').length} done</p>
        </div>
        <label className="check-row small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label>
      </div>
      {shown.length === 0 ? <NoRequests /> : shown.map((r) => <StaffRequest key={r.id} request={r} onChanged={queue.reload} />)}
    </div>
  );
}

const KIND_LABEL: Record<ErrorGroup['kind'], string> = { error: 'Crash', failed_action: 'Failed action', report: 'Golfer report' };
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** App health: problems the app reported, failed timers and calls, and capacity against the plan limits. */
function Health() {
  const [days, setDays] = useState(7);
  const [showFixed, setShowFixed] = useState(false);
  const health = useAsync(() => api.staffHealth(days), [days], { fresh: true });
  const { busy, error, run } = useAction();
  const h = health.data;
  const errors = (h?.errors ?? []).filter((e) => showFixed || !e.resolved);
  const capacity = h ? capacityLines(h) : [];

  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>App health</h2>
        <div className="row wrap">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="How far back">
            <option value={1}>Last day</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
          </select>
          <button className="btn btn-ghost btn-sm" disabled={health.loading} onClick={health.reload}>Refresh</button>
        </div>
      </div>
      <ErrorText>{health.error ?? error}</ErrorText>
      {!h ? <p className="small muted">Checking…</p> : (
        <>
          <div className="stack">
            <h3>Capacity</h3>
            {capacity.map((c) => <LimitRow key={c.key} line={c} busy={busy} onSave={async (v) => { await run(() => api.staffSetLimit(c.key, v)); health.reload(); }} />)}
            <p className="small muted">
              Online now: {h.usage.online_now ?? 0} · busiest this week: {h.usage.online_peak_week ?? 0} · groups scoring at once (week): {h.usage.live_rounds_peak_week ?? 0}<br />
              Leagues: {h.usage.leagues ?? 0} ({h.usage.active_leagues ?? 0} played in the last 2 weeks) · golfers: {h.usage.golfers ?? 0} · on the app: {h.usage.app_users ?? 0} · phones with notifications: {h.usage.devices_with_notifications ?? 0}
            </p>
            <p className="small muted">Amber at {Math.round(WARN_AT * 100)}%: upgrade that plan, then raise the limit here. Emails count reminders and recaps (not sign-in emails).</p>
          </div>

          {(h.failed_jobs.length > 0 || h.failed_calls.length > 0) && (
            <div className="stack">
              <h3 className="warn">Failed in the last day</h3>
              {h.failed_jobs.map((j, i) => <p key={`j${i}`} className="small"><strong>Timer {j.job}</strong> · {ago(j.at)} · {j.message}</p>)}
              {h.failed_calls.map((c, i) => <p key={`c${i}`} className="small"><strong>Server call {c.status ?? 'no answer'}</strong> · {ago(c.at)} · {c.message}</p>)}
            </div>
          )}

          <div className="stack">
            <div className="row between wrap">
              <h3>Problems ({errors.length})</h3>
              <label className="check-row small"><input type="checkbox" checked={showFixed} onChange={(e) => setShowFixed(e.target.checked)} /> Show fixed</label>
            </div>
            {errors.length === 0 ? <p className="small good">Nothing reported{showFixed ? '' : ' that is still open'}.</p> : (
              <ul className="list health-list">
                {errors.map((e) => (
                  <li key={e.fingerprint} className={`list-row stack${e.resolved ? ' muted' : ''}`}>
                    <div className="row between wrap">
                      <span><span className={`badge ${e.kind === 'report' ? 'badge-pro' : e.kind === 'error' ? 'badge-live' : 'badge-neutral'}`}>{KIND_LABEL[e.kind]}</span> <strong>{e.message}</strong></span>
                      {!e.resolved && <button className="btn btn-sm" disabled={busy} onClick={async () => { await run(() => api.staffResolveError(e.fingerprint)); health.reload(); }}>Mark fixed</button>}
                    </div>
                    <div className="small muted">
                      {e.count}× · {e.people} {e.people === 1 ? 'person' : 'people'} · last {ago(e.last_seen)} · first {ago(e.first_seen)}
                      {e.league && <> · {e.league}</>}{e.path && <> · {e.path}</>}{e.app_version && <> · version {e.app_version}</>}{e.reported_by && <> · {e.reported_by}</>}
                    </div>
                    {(e.detail || e.user_agent) && (
                      <details className="small">
                        <summary>Details</summary>
                        {e.detail && <pre className="recap-text">{e.detail}</pre>}
                        {e.user_agent && <p className="muted">{e.user_agent}</p>}
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function LimitRow({ line, busy, onSave }: { line: ReturnType<typeof capacityLines>[number]; busy: boolean; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row between wrap small">
        <span>{line.label}</span>
        <span className={line.warn ? 'warn' : ''}><strong>{line.used}</strong> of {line.limit} ({Math.round(line.share * 100)}%)
          {editing === null
            ? <button type="button" className="linkish" onClick={() => setEditing(String(line.limit))}>Change limit</button>
            : <>
                <input className="limit-input" inputMode="numeric" value={editing} onChange={(e) => setEditing(e.target.value.replace(/[^\d.]/g, ''))} aria-label="New limit" />
                <button type="button" className="btn btn-sm" disabled={busy || !(Number(editing) > 0)} onClick={() => { onSave(Number(editing)); setEditing(null); }}>Save</button>
              </>}
        </span>
      </div>
      <div className="meter" role="meter" aria-valuenow={Math.round(line.share * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={line.label}>
        <span className={line.warn ? 'warn' : ''} style={{ width: `${Math.min(100, line.share * 100)}%` }} />
      </div>
    </div>
  );
}

const PILOT_SPOTS = 10;

/** Pilot sign-up links: one code per league being recruited (or more uses for a club with several leagues). */
function PilotCodes() {
  const codes = useAsync(() => api.staffPilotCodes(), []);
  const [note, setNote] = useState('');
  const [uses, setUses] = useState('1');
  const [made, setMade] = useState<string | null>(null);
  const { busy, error, setError, run } = useAction();
  const link = (code: string) => `${window.location.origin}/pilot/${code}`;
  const joined = (codes.data ?? []).reduce((n, c) => n + c.leagues.length, 0);

  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>Pilot codes</h2>
        <span className="small muted">{joined} of {PILOT_SPOTS} pilot leagues signed up</span>
      </div>
      <p className="small muted">Make a code for each league you're recruiting and send them the link. They sign in, name their league (or pick a free one they run) and it's on the pilot plan, free through 2027.</p>
      <form className="row wrap" onSubmit={async (e) => {
        e.preventDefault();
        const n = Number(uses);
        if (!(n >= 1 && n <= 50)) return setError('Uses: 1 to 50.');
        const code = await run(() => api.createPilotCode(note, n));
        if (code) { setMade(code); setNote(''); setUses('1'); codes.reload(); }
      }}>
        <input className="grow" placeholder="Who it's for, e.g. Crystal Lake Tuesday men" value={note} onChange={(e) => { setNote(e.target.value); setError(null); }} maxLength={120} />
        <label className="inline" style={{ maxWidth: 110 }}>Leagues<input inputMode="numeric" value={uses} onChange={(e) => setUses(e.target.value.replace(/\D/g, ''))} /></label>
        <button className="btn btn-primary btn-sm" disabled={busy}>Make a code</button>
      </form>
      {made && (
        <div className="subcard stack">
          <strong>New pilot link</strong>
          <CopyField value={link(made)} />
        </div>
      )}
      <ErrorText>{error ?? codes.error}</ErrorText>
      {(codes.data ?? []).length > 0 && (
        <ul className="list">
          {codes.data!.map((c) => (
            <li key={c.code} className="list-row">
              <div className="grow">
                <strong className="mono">{c.code}</strong>{c.note && <span className="muted"> · {c.note}</span>}
                <div className="small muted">
                  {c.revokedAt ? 'Ended' : `${c.uses} of ${c.maxUses} used`}
                  {c.leagues.length > 0 && <> · {c.leagues.map((l, i) => <span key={l.id}>{i > 0 && ', '}<Link to={`/l/${l.slug}`}>{l.name}</Link></span>)}</>}
                </div>
              </div>
              {!c.revokedAt && c.uses < c.maxUses && (
                <div className="row">
                  <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(link(c.code))}>Copy link</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy}
                    onClick={async () => { if (window.confirm(`End ${c.code}? The link stops working.`)) { await run(() => api.revokePilotCode(c.code)); codes.reload(); } }}>End</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StaffRequest({ request: r, onChanged }: { request: StaffSetupRequest; onChanged: () => void }) {
  const nav = useNavigate();
  const [status, setStatus] = useState<SetupStatus>(r.status);
  const [reply, setReply] = useState(r.staffReply ?? '');
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const joined = !!r.staffUserId;

  return (
    <section className="card stack">
      <div className="row between wrap">
        <div>
          <strong>{r.leagueName}</strong> <span className="badge badge-neutral">{r.leaguePlan}</span>
          <div className="small muted">
            {r.requestedByEmail ? <a href={`mailto:${r.requestedByEmail}`}>{r.requestedByEmail}</a> : 'unknown sender'}
            {r.contactPhone && <> · <a href={`tel:${r.contactPhone}`}>{r.contactPhone}</a></>}
            {' · '}sent {new Date(r.createdAt).toLocaleString()}{r.updatedAt !== r.createdAt ? ` · updated ${new Date(r.updatedAt).toLocaleString()}` : ''}
          </div>
        </div>
        <span className={`badge ${SETUP_STATUS[r.status].badge}`}>{SETUP_STATUS[r.status].label}</span>
      </div>
      {r.wants.length > 0 && <p className="small">{r.wants.map((w) => SETUP_WANTS.find((x) => x.key === w)?.label ?? w).join(' · ')}</p>}
      {r.notes && <p className="small pre-wrap subcard">{r.notes}</p>}
      {r.files.length > 0 ? <FileLinks files={r.files} /> : <p className="small muted">No files.</p>}

      <div className="row wrap">
        {r.status !== 'done' && r.staffAccess && (
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={async () => { const slug = await run(() => api.staffJoinLeague(r.id)); if (slug) nav(`/l/${slug}`); }}
          >
            {joined ? 'Open the league' : 'Join the league to set it up'}
          </button>
        )}
        {!r.staffAccess && <span className="small warn">The commissioner didn't give support access to the league.</span>}
      </div>

      <div className="subcard stack">
        <label className="inline">
          Status
          <select value={status} onChange={(e) => { setStatus(e.target.value as SetupStatus); setSaved(false); }}>
            {(Object.keys(SETUP_STATUS) as SetupStatus[]).map((s) => <option key={s} value={s}>{SETUP_STATUS[s].label}</option>)}
          </select>
        </label>
        <label>
          Message to the commissioner
          <textarea rows={4} maxLength={4000} value={reply} placeholder={status === 'needs_info' ? 'What do you need from them?' : status === 'done' ? "e.g. You're all set: 24 golfers, handicaps and both nines are in." : ''} onChange={(e) => { setReply(e.target.value); setSaved(false); }} />
        </label>
        {status === 'done' && joined && <p className="small muted">Marking it done takes you out of the league.</p>}
        <ErrorText>{error}</ErrorText>
        {saved && <p className="small good">Saved and emailed to the commissioner.</p>}
        <div>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={async () => { const ok = await run(async () => { await api.staffUpdateSetupRequest(r.id, status, reply); return true; }); if (ok) { setSaved(true); onChanged(); } }}
          >
            {busy ? 'Saving…' : 'Save and email the commissioner'}
          </button>
        </div>
      </div>
    </section>
  );
}
