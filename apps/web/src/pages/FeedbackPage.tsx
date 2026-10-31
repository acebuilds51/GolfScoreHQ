import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ErrorText } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync } from '../lib/hooks';
import type { Feedback, FeedbackKind, FeedbackStatus } from '../lib/types';

export const FEEDBACK_STATUS: Record<FeedbackStatus, { label: string; badge: string }> = {
  new: { label: 'Sent', badge: 'badge-neutral' },
  planned: { label: 'Planned', badge: 'badge-pro' },
  done: { label: 'In the app ✓', badge: 'badge-ok' },
  not_now: { label: 'Not now', badge: 'badge-neutral' },
  answered: { label: 'Answered', badge: 'badge-ok' },
};

const KINDS: { k: FeedbackKind; icon: string; label: string; placeholder: string }[] = [
  { k: 'idea', icon: '💡', label: 'I have an idea', placeholder: 'e.g. Show the skins pot on the clubhouse TV.' },
  { k: 'question', icon: '🙋', label: 'I have a question for you', placeholder: 'e.g. We play the front nine one week and the back the next. How should I set that up?' },
];

export const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** /feedback: send GolfScoreHQ an idea or a question for a person, and see our replies. ?kind=question picks the question; ?from=<slug> is the league. */
export function FeedbackPage() {
  const [params] = useSearchParams();
  const { state } = useLocation();
  const from = params.get('from');
  const [kind, setKind] = useState<FeedbackKind>(params.get('kind') === 'question' ? 'question' : 'idea');
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const mine = useAsync(() => api.myFeedback(), [], { fresh: true });
  const { busy, error, setError, run } = useAction();
  const k = KINDS.find((x) => x.k === kind)!;
  const back = (state as { back?: string } | null)?.back ?? (from ? `/l/${from}/more` : null);

  async function send() {
    const ok = await run(async () => { await api.sendFeedback(kind, text, from, back); return true; });
    if (ok) { setText(''); setSent(true); mine.reload(); }
  }

  return (
    <div className="page narrow stack feedback-page">
      <div>
        {back && <Link to={back} className="small">← Back</Link>}
        <h1>Ideas and questions</h1>
        <p className="muted">Tell us what would make league night easier, or ask a person about setting up your league. We read every one and answer here, with a notification on your phone if you've turned them on.</p>
      </div>

      <section className="card stack">
        <div className="lesson-feel" role="radiogroup" aria-label="What is it?">
          {KINDS.map((x) => (
            <button key={x.k} type="button" role="radio" aria-checked={kind === x.k} className={kind === x.k ? 'on' : ''}
              onClick={() => { setKind(x.k); setSent(false); setError(null); }}>
              <b aria-hidden="true">{x.icon}</b>{x.label}
            </button>
          ))}
        </div>
        {sent ? (
          <div className="stack">
            <p className="good">Thanks! We got it. Our answer will show below.</p>
            <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setSent(false)}>Send another</button></div>
          </div>
        ) : (
          <>
            <label>
              {kind === 'idea' ? "What's your idea?" : "What's your question?"}
              <textarea rows={5} maxLength={4000} value={text} placeholder={k.placeholder} onChange={(e) => { setText(e.target.value); setError(null); }} />
            </label>
            {kind === 'question' && <p className="small muted">A quick how-to? The <strong>?</strong> button answers right away, any time.</p>}
            <ErrorText>{error}</ErrorText>
            <div><button type="button" className="btn btn-primary" disabled={busy || text.trim().length < 5} onClick={send}>{busy ? 'Sending…' : 'Send'}</button></div>
          </>
        )}
      </section>

      <section className="stack">
        <h2>What you've sent</h2>
        <ErrorText>{mine.error}</ErrorText>
        {!mine.data ? <p className="small muted">Loading…</p>
          : mine.data.length === 0 ? <p className="small muted">Nothing yet.</p>
          : mine.data.map((f) => <SentItem key={f.id} f={f} />)}
      </section>
    </div>
  );
}

function SentItem({ f }: { f: Feedback }) {
  const s = FEEDBACK_STATUS[f.status];
  return (
    <article className="card stack feedback-item">
      <div className="row between wrap small">
        <span className="muted">{f.kind === 'idea' ? '💡 Idea' : '🙋 Question'} · {when(f.createdAt)}{f.leagueName ? ` · ${f.leagueName}` : ''}</span>
        <span className={`badge ${s.badge}`}>{s.label}</span>
      </div>
      <p className="pre-wrap">{f.message}</p>
      {f.reply && (
        <div className="subcard stack feedback-reply">
          <strong className="small">GolfScoreHQ{f.repliedAt ? ` · ${when(f.repliedAt)}` : ''}</strong>
          <p className="pre-wrap">{f.reply}</p>
        </div>
      )}
    </article>
  );
}
