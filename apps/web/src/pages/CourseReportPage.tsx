import { Link, useParams } from 'react-router-dom';
import { ErrorText, PageSkeleton } from '../components/ui';
import { api } from '../lib/backend';
import { useAsync } from '../lib/hooks';
import { fmtDay } from '../lib/plans';
import { fmtDate } from '../lib/scoring';

/**
 * The course summary (Course plan): every league at the course this season on
 * one page, for the course's manager. Prints on one sheet for the GM's desk.
 */
export function CourseReportPage() {
  const { clubId = '' } = useParams();
  const report = useAsync(() => api.courseReport(clubId), [clubId]);

  if (report.error) return <div className="page"><ErrorText>{report.error}</ErrorText></div>;
  if (!report.data) return <PageSkeleton />;
  const r = report.data;
  const sum = (k: 'golfers' | 'subs' | 'onApp' | 'rounds' | 'weeksPlayed') => r.leagues.reduce((n, l) => n + l[k], 0);
  const active = !!r.expiresAt && new Date(r.expiresAt) > new Date();
  const tiles = [
    { label: 'Leagues', value: r.leagues.length },
    { label: 'Golfers', value: sum('golfers'), note: sum('subs') ? `+ ${sum('subs')} subs` : undefined },
    { label: 'Using the app', value: sum('onApp') },
    { label: 'Rounds played', value: sum('rounds'), note: `in ${sum('weeksPlayed')} league nights` },
  ];

  return (
    <div className="page stack course-report">
      <div className="row between wrap">
        <div>
          <Link to="/leagues" className="small no-print">← Your leagues</Link>
          <h1>{r.name}</h1>
          <p className="small muted">League summary, {new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} · Course plan {active ? `active through ${fmtDay(r.expiresAt!)}` : 'not active'}</p>
        </div>
        <button className="btn btn-sm no-print" onClick={() => window.print()}>Print</button>
      </div>

      <div className="stat-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="stat-tile">
            <div className="small muted">{t.label}</div>
            <div className="stat-value">{t.value.toLocaleString()}</div>
            {t.note && <div className="small muted">{t.note}</div>}
          </div>
        ))}
      </div>

      <section className="card flush">
        {r.leagues.length === 0 ? (
          <p className="pad muted">No leagues on this course yet.</p>
        ) : (
          <div className="scroll-x">
            <table className="money">
              <thead><tr><th>League</th><th>Season</th><th>Golfers</th><th>On the app</th><th>Weeks played</th><th>Rounds</th><th>Per night</th><th>Next week</th></tr></thead>
              <tbody>
                {r.leagues.map((l) => (
                  <tr key={l.id}>
                    <td className="name"><Link to={`/l/${l.slug}`}>{l.name}</Link></td>
                    <td>{l.season ?? <span className="muted">None yet</span>}</td>
                    <td>{l.golfers}{l.subs > 0 && <span className="muted"> + {l.subs} subs</span>}</td>
                    <td>{l.onApp}</td>
                    <td>{l.weeksPlayed}{l.weeksLeft > 0 && <span className="muted"> of {l.weeksPlayed + l.weeksLeft}</span>}</td>
                    <td>{l.rounds}</td>
                    <td>{l.weeksPlayed ? Math.round(l.rounds / l.weeksPlayed) : '—'}</td>
                    <td>{l.nextWeek ? fmtDate(l.nextWeek) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="small muted">This season so far. Rounds counts each golfer's round in a finished league night, so it's the number of rounds your leagues brought to the course. Per night is the average turnout.</p>
    </div>
  );
}
