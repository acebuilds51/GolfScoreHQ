import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HELP_SECTIONS, searchHelp, type HelpAudience, type HelpItem } from '../../../../supabase/functions/ask-help/manual';
import { ASK_MAX_CHARS } from '../../../../supabase/functions/ask-help/ask';
import { api } from '../lib/backend';
import { reportProblem } from '../lib/diagnostics';
import { guideHref, searchGuide } from '../lib/guideSearch';
import { useAuth } from '../lib/hooks';

const AUDIENCES: { key: HelpAudience | 'all'; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'commissioner', label: 'Commissioners' },
  { key: 'golfer', label: 'Golfers' },
];

/** Questions and answers for commissioners and golfers, plus "Ask a question" answered from the same page. */
export function HelpPage() {
  const { hash, search } = useLocation();
  const [query, setQuery] = useState(() => new URLSearchParams(search).get('q') ?? '');
  const [who, setWho] = useState<HelpAudience | 'all'>('all');
  const found = useMemo(() => (query.trim().length >= 2 ? searchHelp(query, 6) : null), [query]);
  const chapters = useMemo(() => (query.trim().length >= 2 ? searchGuide(query) : []), [query]);
  // "Ask this" under the search results hands the search to Ask a question.
  const [askSeed, setAskSeed] = useState<{ text: string; n: number } | null>(null);
  const open = hash.slice(1);

  // A link like /help#settle-week opens that answer and scrolls to it.
  useEffect(() => {
    if (open) document.getElementById(open)?.scrollIntoView({ block: 'center' });
  }, [open]);

  const sections = HELP_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => who === 'all' || i.who === 'everyone' || i.who === who) })).filter((s) => s.items.length);

  return (
    <div className="page stack help-page">
      <div>
        <h1>Help</h1>
        <p className="muted">How to run league night with GolfScoreHQ, for commissioners and golfers. Can't find it? Ask at the bottom of the page.</p>
        <p className="small">New to GolfScoreHQ? The <Link to="/guide">commissioner's guide</Link> and <Link to="/guide?for=golfers">golfer's guide</Link> walk through the season step by step.</p>
      </div>
      <input
        type="search" className="help-search" placeholder="Search: settle a week, add a sub, Venmo, handicaps…" value={query}
        aria-label="Search the help" onChange={(e) => setQuery(e.target.value)}
      />
      {found ? (
        <>
          <section className="card stack help-ask-this">
            <p>Want an answer written out for you, step by step?</p>
            <div>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setAskSeed({ text: query.trim(), n: (askSeed?.n ?? 0) + 1 })}>
                Ask: "{query.trim().length > 60 ? `${query.trim().slice(0, 57)}…` : query.trim()}"
              </button>
            </div>
            {chapters.length > 0 && (
              <p className="small">
                Or read it in the user's guide:{' '}
                {chapters.map((m, n) => (
                  <span key={`${m.guide.id}-${m.chapter.id}`}>{n > 0 && ' · '}<Link to={guideHref(m)}>{m.guide.id === 'golfers' ? "Golfer's" : "Commissioner's"} guide: {m.chapter.title}</Link></span>
                ))}
              </p>
            )}
          </section>
          <section className="card flush">
            <h2 className="pad">{found.length ? `${found.length} matching question${found.length === 1 ? '' : 's'}` : 'No questions match that'}</h2>
            {found.length > 0 ? (
              <div className="help-list">{found.map((i) => <HelpEntry key={i.id} item={i} open={i.id === open || i === found[0]} />)}</div>
            ) : (
              <p className="pad muted small">Try other words, or tap Ask above.</p>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="segmented-row" role="tablist" aria-label="Show questions for">
            {AUDIENCES.map((a) => (
              <button key={a.key} type="button" role="tab" aria-selected={who === a.key} className={`chip${who === a.key ? ' on' : ''}`} onClick={() => setWho(a.key)}>{a.label}</button>
            ))}
          </div>
          <nav className="help-topics" aria-label="Topics">
            {sections.map((s) => <a key={s.id} href={`#${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' }); }}>{s.icon} {s.title}</a>)}
          </nav>
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="card flush">
              <h2 className="pad">{s.icon} {s.title}</h2>
              <div className="help-list">{s.items.map((i) => <HelpEntry key={i.id} item={i} open={i.id === open} />)}</div>
            </section>
          ))}
        </>
      )}
      <AskQuestion seed={askSeed} />
    </div>
  );
}

function HelpEntry({ item, open }: { item: HelpItem; open: boolean }) {
  return (
    <details id={item.id} className="help-item" open={open}>
      <summary>
        <span className="grow">{item.q}</span>
        {item.pro && <span className="badge badge-pro">Pro</span>}
      </summary>
      <div className="help-answer">{item.a.split('\n').map((line, n) => <p key={n}>{line}</p>)}</div>
    </details>
  );
}

type Msg = { role: 'user' | 'assistant'; content: string; id?: string | null; err?: boolean; rated?: boolean; sent?: boolean };

/** Like Ladle & Spoon's helper: answers come from this page; anything it can't answer goes to a person. */
function AskQuestion({ seed }: { seed: { text: string; n: number } | null }) {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLElement>(null);
  // Which league they came from (the More page links here with ?from=slug).
  const leagueSlug = new URLSearchParams(search).get('from');

  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [msgs, busy]);

  // "Ask" under the search results: jump down here and ask it (or show how to sign in first).
  useEffect(() => {
    if (!seed) return;
    // After the question shows in the box, so the page has its final height.
    window.setTimeout(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
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

  function sendToUs(i: number) {
    const q = [...msgs.slice(0, i)].reverse().find((m) => m.role === 'user')?.content ?? '';
    const convo = msgs.slice(0, i + 1).map((m) => `${m.role === 'user' ? 'Q' : 'A'}: ${m.content}`).join('\n\n');
    reportProblem('report', `Help question: ${q}`.slice(0, 200), `${convo}\n\n(from ${pathname}${leagueSlug ? `, league ${leagueSlug}` : ''})`);
    patch(i, { sent: true });
  }

  return (
    <section className="card stack" id="ask" ref={box}>
      <h2>Ask a question</h2>
      {!user ? (
        <p className="muted">
          <Link to="/">Sign in</Link> to ask a question. Or email <a href="mailto:support@golfscorehq.app">support@golfscorehq.app</a>.
        </p>
      ) : (
        <>
          <p className="small muted">Answers come from the questions on this page. If it isn't sure, tap Send it to us and a person will email you back.</p>
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
                        ? <span className="good">Sent. We'll email you at {user.email}.</span>
                        : <button type="button" className="linkish" onClick={() => sendToUs(i)}>Send it to us</button>}
                    </div>
                  )}
                </div>
              ))}
              {busy && <div className="small muted">Looking that up…</div>}
            </div>
          )}
          <form className="help-ask" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
            <textarea
              rows={2} maxLength={ASK_MAX_CHARS} value={text} aria-label="Your question"
              placeholder={msgs.length ? 'Ask a follow-up…' : 'e.g. How do I add a sub on league night?'}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(); } }}
            />
            <button className="btn btn-primary" disabled={busy || !text.trim()}>Ask</button>
          </form>
          {msgs.length > 0 && !busy && <div><button type="button" className="linkish small" onClick={() => setMsgs([])}>Start over</button></div>}
        </>
      )}
    </section>
  );
}
