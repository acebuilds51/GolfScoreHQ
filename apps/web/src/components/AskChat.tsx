import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ASK_MAX_CHARS } from '../../../../supabase/functions/ask-help/ask';
import { api } from '../lib/backend';
import { reportProblem } from '../lib/diagnostics';
import { useAuth } from '../lib/hooks';

type Msg = { role: 'user' | 'assistant'; content: string; id?: string | null; err?: boolean; rated?: boolean; sent?: boolean };

/**
 * "Ask a question", on the Help page and in the ? popup on every screen. Like
 * Ladle & Spoon's helper: answers come from the Help page and the user's guide;
 * anything it can't answer goes to a person.
 */
export function AskChat({ leagueSlug, seed, autoFocus }: {
  /** The league they're asking from, saved with the question for staff. */
  leagueSlug: string | null;
  /** Ask this right away (the Help search's "Ask" button). */
  seed?: { text: string; n: number } | null;
  autoFocus?: boolean;
}) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [msgs, busy]);
  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);

  useEffect(() => {
    if (!seed) return;
    if (user) void ask(seed.text.slice(0, ASK_MAX_CHARS));
    else setText(seed.text.slice(0, ASK_MAX_CHARS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.n]);

  async function ask(question = text) {
    const q = question.trim();
    if (!q || busy) return;
    const next = [...msgs, { role: 'user' as const, content: q }];
    setMsgs(next);
    setText('');
    setBusy(true);
    try {
      const convo = next.filter((m) => !m.err).map(({ role, content }) => ({ role, content }));
      const r = await api.askHelp(convo, leagueSlug);
      setMsgs([...next, { role: 'assistant', content: r.answer, id: r.id }]);
    } catch (e) {
      setMsgs([...next, { role: 'assistant', err: true, content: e instanceof Error ? e.message : 'Something went wrong. Try again.' }]);
    } finally {
      setBusy(false);
    }
  }

  const patch = (i: number, p: Partial<Msg>) => setMsgs((all) => all.map((m, n) => (n === i ? { ...m, ...p } : m)));

  // A person answers it under Ideas and questions (/feedback), with a notification.
  async function sendToUs(i: number) {
    const convo = msgs.slice(0, i + 1).map((m) => `${m.role === 'user' ? 'Asked' : 'The helper said'}: ${m.content}`).join('\n\n');
    try {
      await api.sendFeedback('question', convo.slice(0, 4000), leagueSlug, pathname);
      patch(i, { sent: true });
    } catch {
      // Still reaches us, just without a way to answer in the app.
      const q = [...msgs.slice(0, i)].reverse().find((m) => m.role === 'user')?.content ?? '';
      reportProblem('report', `Help question: ${q}`.slice(0, 200), `${convo}\n\n(from ${pathname}${leagueSlug ? `, league ${leagueSlug}` : ''})`);
      patch(i, { sent: true });
    }
  }

  if (!user) {
    return (
      <p className="muted">
        <Link to="/">Sign in</Link> to ask a question. Or email <a href="mailto:support@golfscorehq.app">support@golfscorehq.app</a>.
      </p>
    );
  }
  return (
    <>
      {(msgs.length > 0 || busy) && (
        <div className="help-chat" ref={log}>
          {msgs.map((m, i) => (
            <div key={i} className={`help-msg ${m.role === 'user' ? 'mine' : m.err ? 'err' : ''}`}>
              <div className="pre-wrap">{m.content}</div>
              {m.role === 'assistant' && (
                <div className="row wrap help-msg-actions small">
                  {m.id && !m.err && (m.rated ? <span className="muted">Thanks!</span> : (
                    <>
                      <span className="muted">Did this help?</span>
                      <button type="button" className="linkish" onClick={() => { void api.rateHelpAnswer(m.id!, true).catch(() => undefined); patch(i, { rated: true }); }}>Yes</button>
                      <button type="button" className="linkish" onClick={() => { void api.rateHelpAnswer(m.id!, false).catch(() => undefined); patch(i, { rated: true }); }}>No</button>
                    </>
                  ))}
                  {m.sent
                    ? <span className="good">Sent. A person will answer under <Link to={`/feedback${leagueSlug ? `?from=${encodeURIComponent(leagueSlug)}` : ''}`}>Ideas and questions</Link>.</span>
                    : <button type="button" className="linkish" onClick={() => void sendToUs(i)}>Send it to us</button>}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="small muted">Looking that up…</div>}
        </div>
      )}
      <form className="help-ask" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
        <textarea
          ref={input} rows={2} maxLength={ASK_MAX_CHARS} value={text} aria-label="Your question"
          placeholder={msgs.length ? 'Ask a follow-up…' : 'e.g. How do I add a sub on league night?'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(); } }}
        />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>Ask</button>
      </form>
      {msgs.length > 0 && !busy && <div><button type="button" className="linkish small" onClick={() => setMsgs([])}>Start over</button></div>}
    </>
  );
}
