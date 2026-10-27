import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorText, ProLock, PageSkeleton } from '../components/ui';
import { AWARD_UNITS } from '../lib/awards';
import { useAsync, useLeague } from '../lib/hooks';
import { fmtMoney, individualRules, playsForMoney } from '../lib/scoring';
import { loadSeasonData } from '../lib/seasonData';
import { fmtToPar, sortStandings, type SortKey, type StandingRow } from '../lib/standings';

export function StandingsPage() {
  const { league } = useLeague();
  const data = useAsync(() => loadSeasonData(league.id), [league.id]);

  const rules = data.data ? data.data.season.rules : null;
  const hasMoney = !!rules && playsForMoney(rules);
  const individual = !!rules && individualRules(rules) !== null;
  const stableford = rules?.format === 'stableford';
  const [sort, setSort] = useState<SortKey | null>(null);
  const sortKey: SortKey = sort ?? (hasMoney ? 'money' : stableford ? 'points' : 'average');
  const rows = useMemo(() => (data.data ? sortStandings(data.data.standings.rows, sortKey) : []), [data.data, sortKey]);
  const [open, setOpen] = useState<string | null>(null);

  if (data.error) return <div className="page"><ErrorText>{data.error}</ErrorText></div>;
  if (data.loading && !data.data) return <PageSkeleton />;
  if (!data.data) {
    return <div className="page"><EmptyState title="No season yet"><p className="muted">Standings appear once the season is set up and the first week is settled.</p></EmptyState></div>;
  }
  const { season, standings } = data.data;
  if (standings.weeksCounted === 0) {
    return (
      <div className="page">
        <EmptyState title="No settled weeks yet">
          <p className="muted">Standings fill in after the commissioner settles a week on the <Link to="../play">Play</Link> tab.</p>
        </EmptyState>
      </div>
    );
  }

  const sorts: { key: SortKey; label: string; show: boolean }[] = [
    { key: 'money', label: 'Money', show: hasMoney },
    { key: 'points', label: 'Points', show: stableford },
    { key: 'average', label: 'Average', show: true },
    { key: 'wins', label: 'Wins', show: !individual },
    { key: 'weekWins', label: 'Wins', show: individual },
    { key: 'skins', label: 'Skins', show: !!rules?.skins.enabled },
    { key: 'ctps', label: 'CTP', show: !!rules?.ctp.enabled },
  ];
  const showAwards = league.features.includes('awards');

  return (
    <div className="page stack">
      <div className="row between wrap">
        <div>
          <h2>{season.name || `${season.year} season`}</h2>
          <p className="small muted">Through {standings.weeksCounted} settled week{standings.weeksCounted === 1 ? '' : 's'}. Averages count full rounds only.</p>
        </div>
        <div className="row wrap pills" role="group" aria-label="Sort by">
          {sorts.filter((s) => s.show).map((s) => (
            <button key={s.key} type="button" className={`pill ${sortKey === s.key ? 'on' : ''}`} aria-pressed={sortKey === s.key} onClick={() => setSort(s.key)}>{s.label}</button>
          ))}
        </div>
      </div>

      <section className="card flush scroll-x">
        <table className="standings">
          <thead>
            <tr>
              <th className="sticky">Golfer</th>
              <th>Rds</th>
              <th>Avg</th>
              <th>Last 4</th>
              <th>Best</th>
              {stableford && <th>Pts</th>}
              {stableford && <th>Avg pts</th>}
              {individual ? <><th>Wins</th><th>Top 3</th></> : <th>W-L-H</th>}
              {rules?.skins.enabled && <th>Skins</th>}
              {rules?.ctp.enabled && <th>CTP</th>}
              {hasMoney && <th>Money</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Row key={r.playerId} r={r} rank={i + 1} open={open === r.playerId} onToggle={() => setOpen(open === r.playerId ? null : r.playerId)}
                skins={!!rules?.skins.enabled} ctp={!!rules?.ctp.enabled} money={hasMoney} individual={individual} stableford={stableford} />
            ))}
          </tbody>
        </table>
      </section>
      <p className="small muted">Avg is the average score, with strokes over par in brackets. Last 4 is strokes over par over the last four rounds; 🔥 means the last four are at least half a stroke better than the season average. Tap a golfer for their weekly scores and full stats.</p>

      <section className="card stack">
        <div className="row between">
          <h2>Season awards so far</h2>
          {showAwards ? <Link className="small" to="../awards">Awards and course stats →</Link> : <ProLock />}
        </div>
        {showAwards ? (
          standings.awards.length ? (
            <ul className="awards">
              {standings.awards.slice(0, 6).map((a) => (
                <li key={a.key}>
                  <strong>{a.title}</strong>
                  <span>{a.winners.map((id) => rows.find((r) => r.playerId === id)?.name ?? '?').join(', ')}</span>
                  <span className="small muted">{AWARD_UNITS[a.key]?.(a.value)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="small muted">Awards appear as golfers play enough rounds.</p>
        ) : (
          <p className="small muted">Pro leagues get running awards (low average, skins leader, CTP king, money leader and more), player stats and an end-of-season awards page with a picture to share.</p>
        )}
      </section>
    </div>
  );
}

function Row({ r, rank, open, onToggle, skins, ctp, money, individual, stableford }: {
  r: StandingRow; rank: number; open: boolean; onToggle: () => void; skins: boolean; ctp: boolean; money: boolean; individual: boolean; stableford: boolean;
}) {
  const cols = 6 + (individual ? 1 : 0) + (stableford ? 2 : 0) + (skins ? 1 : 0) + (ctp ? 1 : 0) + (money ? 1 : 0);
  return (
    <>
      <tr className="clickable" onClick={onToggle} aria-expanded={open}>
        <td className="sticky name">
          <span className="rank">{rank}</span> {r.name}
          {r.isSub && <span className="badge badge-neutral">Sub</span>}
          {r.hot && <span title="Hot streak"> 🔥</span>}
        </td>
        <td>{r.rounds}</td>
        <td>{r.average ?? '—'}{r.averageToPar !== null && <span className="muted small"> ({fmtToPar(r.averageToPar)})</span>}</td>
        <td>{fmtToPar(r.last4AverageToPar)}</td>
        <td>{r.best ? r.best.score : '—'}</td>
        {stableford && <td><strong>{r.points || ''}</strong></td>}
        {stableford && <td>{r.averagePoints ?? '—'}</td>}
        {individual ? <><td>{r.weekWins || ''}</td><td>{r.top3 || ''}</td></> : <td>{r.wins}-{r.losses}-{r.halves}</td>}
        {skins && <td>{r.skins || ''}</td>}
        {ctp && <td>{r.ctps || ''}</td>}
        {money && <td className={r.money > 0 ? 'good' : r.money < 0 ? 'warn' : ''}><strong>{r.money > 0 ? '+' : r.money < 0 ? '−' : ''}{fmtMoney(Math.abs(r.money))}</strong></td>}
      </tr>
      {open && (
        <tr className="detail">
          <td colSpan={cols}>
            {r.weeks.length ? (
              <div className="week-chips">
                {r.weeks.map((w) => <span key={w.week} className="chip">Wk {w.week}: <strong>{w.score}</strong> <span className="muted">{fmtToPar(w.toPar)}</span></span>)}
              </div>
            ) : <span className="small muted">No full rounds yet.</span>}
            <div><Link className="small" to={`../player/${r.playerId}`}>All of {r.name.split(' ')[0]}'s stats →</Link></div>
          </td>
        </tr>
      )}
    </>
  );
}
