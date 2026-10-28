import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CopyField, ErrorText, PageSkeleton } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync } from '../lib/hooks';
import type { SetupStatus, StaffSetupRequest } from '../lib/types';
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
