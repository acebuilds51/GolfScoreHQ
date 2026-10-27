import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorText, PageSkeleton, ProLock } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync, useLeague } from '../lib/hooks';
import { isCommissioner, type SetupFile, type SetupRequest, type SetupStatus, type SetupWant } from '../lib/types';

export const SETUP_WANTS: { key: SetupWant; label: string }[] = [
  { key: 'roster', label: 'Roster, emails and phone numbers' },
  { key: 'handicaps', label: 'Handicaps (GHIN numbers or indexes)' },
  { key: 'course', label: 'Our course and scorecard' },
  { key: 'history', label: 'Past rounds and results (this or last season)' },
  { key: 'side_games', label: 'Format, side games and money rules' },
];

export const SETUP_STATUS: Record<SetupStatus, { label: string; badge: string }> = {
  requested: { label: 'Sent — we\'ll be in touch', badge: 'badge-neutral' },
  in_progress: { label: 'We\'re working on it', badge: 'badge-live' },
  needs_info: { label: 'We have a question', badge: 'badge-pro' },
  done: { label: 'All set up', badge: 'badge-ok' },
};

const ACCEPT = '.csv,.txt,.json,.pdf,.xls,.xlsx,.ods,image/*';
const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** "We set up your league" (Pro): send us what you have and we'll do the typing. */
export function SetupServicePage() {
  const { league } = useLeague();
  const commish = isCommissioner(league.role);
  const pro = league.features.includes('setup_service');
  const data = useAsync(async () => (commish && pro ? api.setupRequests(league.id) : []), [league.id, commish, pro]);
  const [composing, setComposing] = useState(false);
  // The request saved but the email notice to GolfScoreHQ failed: say so (and why) instead of looking fine.
  const [emailError, setEmailError] = useState<string | null>(null);
  const sent = (err: string | null) => { setEmailError(err); data.reload(); };

  if (!commish) return <div className="page muted">Only commissioners can ask us to set up the league.</div>;
  if (!pro) {
    return (
      <div className="page stack">
        <div className="row between"><h2>We set up your league</h2><ProLock /></div>
        <p className="muted">Send us your roster spreadsheet, handicaps, scorecard and last season's results, and we'll enter it all for you. Included with GolfScoreHQ Pro.</p>
        <div><Link className="btn btn-primary" to="../settings">See plans</Link></div>
      </div>
    );
  }
  if (data.error) return <div className="page"><ErrorText>{data.error}</ErrorText></div>;
  if (data.loading && !data.data) return <PageSkeleton />;
  const requests = data.data ?? [];
  const open = requests.filter((r) => r.status !== 'done');

  return (
    <div className="page stack">
      <div>
        <h2>We set up your league</h2>
        <p className="muted">Send us whatever you have — a spreadsheet, last season's results, photos of scorecards — and we'll enter your roster, handicaps, course and history for you. We'll email you if we have a question and when it's done.</p>
        <p className="small muted">Would rather do it yourself? <Link to="../import">Import past rounds</Link> from a spreadsheet, and add golfers on the <Link to="../roster">Roster</Link> page.</p>
      </div>

      {emailError && (
        <p className="small warn">Your request is saved and GolfScoreHQ will see it, but the email notice didn't go out: {emailError}. If it's urgent, write to support@golfscorehq.app.</p>
      )}

      {requests.map((r) => <RequestCard key={r.id} request={r} onChanged={sent} />)}

      {composing || requests.length === 0 ? (
        <NewRequest onSent={(err) => { setComposing(false); sent(err); }} onCancel={requests.length ? () => setComposing(false) : undefined} />
      ) : (
        <div><button className="btn" onClick={() => setComposing(true)}>{open.length ? 'Send something else' : 'Ask for more help'}</button></div>
      )}
    </div>
  );
}

function FilePicker({ files, setFiles, disabled }: { files: SetupFile[]; setFiles: (f: SetupFile[]) => void; disabled?: boolean }) {
  const { league } = useLeague();
  const input = useRef<HTMLInputElement>(null);
  const { busy, error, setError, run } = useAction();
  return (
    <div className="stack">
      <div className="row wrap">
        <button type="button" className="btn btn-sm" disabled={busy || disabled || files.length >= 20} onClick={() => input.current?.click()}>
          <Icon name="download" size={16} /> {busy ? 'Uploading…' : 'Add files'}
        </button>
        <span className="small muted">Spreadsheets, CSV, PDF or photos, up to 20 MB each.</span>
      </div>
      <input
        ref={input} type="file" multiple accept={ACCEPT} hidden
        onChange={async (e) => {
          const picked = [...(e.target.files ?? [])];
          e.target.value = '';
          setError(null);
          const added: SetupFile[] = [];
          await run(async () => {
            for (const f of picked) added.push(await api.uploadSetupFile(league.id, f));
            return true;
          });
          if (added.length) setFiles([...files, ...added]);
        }}
      />
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f) => (
            <li key={f.path} className="row between small">
              <span>📄 {f.name} <span className="muted">{fmtSize(f.size)}</span></span>
              {!disabled && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void api.removeSetupFile(f.path); setFiles(files.filter((x) => x.path !== f.path)); }}>Remove</button>}
            </li>
          ))}
        </ul>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function NewRequest({ onSent, onCancel }: { onSent: (emailError: string | null) => void; onCancel?: () => void }) {
  const { league } = useLeague();
  const [wants, setWants] = useState<SetupWant[]>(['roster', 'handicaps', 'course']);
  const [files, setFiles] = useState<SetupFile[]>([]);
  const [notes, setNotes] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const { busy, error, setError, run } = useAction();

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!files.length && !notes.trim()) return setError('Add a file or tell us what you need.');
        if (!consent) return setError('Tick the box so we can get into the league to set it up.');
        const res = await run(() => api.createSetupRequest(league.id, { notes, wants, files, contactPhone: phone || null, staffAccess: true }));
        if (res) onSent(res.emailError);
      }}
    >
      <h3>What should we set up?</h3>
      <div className="stack">
        {SETUP_WANTS.map((w) => (
          <label key={w.key} className="check-row">
            <input type="checkbox" checked={wants.includes(w.key)} onChange={(e) => setWants(e.target.checked ? [...wants, w.key] : wants.filter((x) => x !== w.key))} />
            {w.label}
          </label>
        ))}
      </div>
      <strong>Your files</strong>
      <FilePicker files={files} setFiles={setFiles} />
      <label>
        Anything we should know?
        <textarea rows={5} maxLength={4000} value={notes} placeholder="e.g. The roster is on the first tab. We play the front nine on odd weeks. Skins are $10 a man." onChange={(e) => setNotes(e.target.value)} />
      </label>
      <label className="inline">
        Phone (optional)
        <input type="tel" value={phone} maxLength={40} placeholder="In case a quick call is easier" onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>GolfScoreHQ support may join {league.name} as a commissioner to set it up. We leave as soon as it's done.</span>
      </label>
      <ErrorText>{error}</ErrorText>
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send to GolfScoreHQ'}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function RequestCard({ request: r, onChanged }: { request: SetupRequest; onChanged: (emailError: string | null) => void }) {
  const [answering, setAnswering] = useState(false);
  const [notes, setNotes] = useState(r.notes);
  const [files, setFiles] = useState<SetupFile[]>(r.files);
  const { busy, error, run } = useAction();
  const status = SETUP_STATUS[r.status];
  const canEdit = r.status === 'requested' || r.status === 'needs_info';

  return (
    <section className="card stack">
      <div className="row between wrap">
        <strong>Sent {new Date(r.createdAt).toLocaleDateString()}</strong>
        <span className={`badge ${status.badge}`}>{status.label}</span>
      </div>
      {r.staffReply && (
        <div className="subcard">
          <div className="small muted">From GolfScoreHQ</div>
          <p className="pre-wrap">{r.staffReply}</p>
        </div>
      )}
      {r.wants.length > 0 && <p className="small">{r.wants.map((w) => SETUP_WANTS.find((x) => x.key === w)?.label ?? w).join(' · ')}</p>}
      {answering ? (
        <>
          <FilePicker files={files} setFiles={setFiles} />
          <label>
            Notes
            <textarea rows={5} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <ErrorText>{error}</ErrorText>
          <div className="row">
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { const res = await run(() => api.updateSetupRequest(r.id, { notes, files })); if (res) { setAnswering(false); onChanged(res.emailError); } }}>
              {busy ? 'Sending…' : 'Send'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAnswering(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          {r.notes && <p className="small pre-wrap">{r.notes}</p>}
          {r.files.length > 0 && <FileLinks files={r.files} />}
          {canEdit && <div><button className="btn btn-sm" onClick={() => setAnswering(true)}>{r.status === 'needs_info' ? 'Answer and send back' : 'Add files or notes'}</button></div>}
        </>
      )}
    </section>
  );
}

/** Uploaded files, each opening a short-lived download link. */
export function FileLinks({ files }: { files: SetupFile[] }) {
  const { error, run } = useAction();
  return (
    <div className="stack">
      <ul className="file-list">
        {files.map((f) => (
          <li key={f.path} className="small">
            <button
              type="button" className="linkish"
              onClick={() => run(async () => {
                // Open the tab right away (popup blockers allow that on a tap), then point it at the signed link.
                const tab = window.open('about:blank', '_blank');
                try {
                  const url = await api.setupFileUrl(f.path);
                  if (tab) tab.location.href = url;
                  else window.location.href = url;
                } catch (e) {
                  tab?.close();
                  throw e;
                }
                return true;
              })}
            >
              📄 {f.name}
            </button>
            <span className="muted"> {fmtSize(f.size)}</span>
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

export function NoRequests() {
  return <EmptyState title="No setup requests"><p className="muted">Nothing waiting.</p></EmptyState>;
}
