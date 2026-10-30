import { useEffect } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { FINDING_YOUR_WAY, GUIDES, type GuideFor } from '../../../../supabase/functions/ask-help/guide';

/** The user's guide: the season step by step, for commissioners or golfers. /guide?for=golfers picks the golfers' one. */
export function GuidePage() {
  const [params, setParams] = useSearchParams();
  const { hash } = useLocation();
  const which: GuideFor = params.get('for') === 'golfers' ? 'golfers' : 'commissioners';
  const guide = GUIDES.find((g) => g.id === which)!;

  // /guide?for=golfers#night jumps to a chapter.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash, which]);

  return (
    <div className="page narrow stack guide-page">
      <div>
        <h1>User's guide</h1>
        <p className="muted">{guide.intro}</p>
        <p className="small no-print">Rather practise? Try the <Link to={which === 'golfers' ? '/lessons' : '/lessons?for=commissioners'}>lessons</Link>: league night on pretend screens, a few minutes each.</p>
      </div>
      <div className="row between wrap no-print">
        <div className="segmented-row" role="tablist" aria-label="Guide for">
          {GUIDES.map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={g.id === which} className={`chip${g.id === which ? ' on' : ''}`}
              onClick={() => setParams(g.id === 'golfers' ? { for: 'golfers' } : {}, { replace: true })}>
              {g.id === 'commissioners' ? 'Commissioners' : 'Golfers'}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}>Print</button>
      </div>
      <h2 className="print-only">{guide.title}</h2>

      <section className="card stack">
        <h2>Contents</h2>
        <ol className="guide-contents">
          {guide.chapters.map((c) => (
            <li key={c.id}><a href={`#${c.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(c.id)?.scrollIntoView({ behavior: 'smooth' }); }}>{c.title}</a></li>
          ))}
        </ol>
        <p className="small muted">{FINDING_YOUR_WAY}</p>
        <p className="small muted no-print"><span className="badge badge-pro">Pro</span> marks steps that need GolfScoreHQ Pro. Leagues on the free plan can skip them.</p>
      </section>

      {guide.chapters.map((c, n) => (
        <section key={c.id} id={c.id} className="card stack guide-chapter">
          <div>
            <p className="small muted guide-num">Part {n + 1} of {guide.chapters.length}</p>
            <h2>{c.title}</h2>
            <p className="muted">{c.intro}</p>
          </div>
          <ol className="guide-steps">
            {c.steps.map((s, i) => (
              <li key={i}>
                <span>{s.text}</span>
                {s.pro && <> <span className="badge badge-pro">Pro</span></>}
                {s.help && <> <Link className="small no-print" to={`/help#${s.help}`}>More</Link></>}
              </li>
            ))}
          </ol>
          {c.tip && <p className="guide-tip small"><strong>Tip:</strong> {c.tip}</p>}
        </section>
      ))}

      <p className="muted no-print">
        Still stuck? The <Link to="/help">Help page</Link> answers the common questions, and you can ask your own at the bottom of it.
      </p>
    </div>
  );
}
