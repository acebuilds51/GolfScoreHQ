import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorText, ProLock, PageSkeleton } from '../components/ui';
import { api } from '../lib/backend';
import { useAsync, useLeague } from '../lib/hooks';
import { allLayouts, asBestBall, fmtMoney } from '../lib/scoring';
import { buildStandings, fmtToPar, sortStandings, type SortKey, type StandingRow } from '../lib/standings';

const AWARD_UNITS: Record<string, (v: number) => string> = {
  lowAverage: (v) => `${fmtToPar(v)} a round`,
  bestRound: (v) => fmtToPar(v),
  mostSkins: (v) => `${v} skin${v === 1 ? '' : 's'}`,
  ctpKing: (v) => `${v} CTP${v === 1 ? '' : 's'}`,
  birdieMachine: (v) => `${v} birdie${v === 1 ? '' : 's'}`,
  eagleClub: () => '',
  aceClub: () => '',
  matchPlayChamp: (v) => `${v} win${v === 1 ? '' : 's'}`,
  moneyLeader: (v) => `+${fmtMoney(v)}`,
  hotStreak: (v) => `${v} better lately`,
  mostImproved: (v) => `index down ${v}`,
};

export function StandingsPage() {
  const { league } = useLeague();
  const data = useAsync(async () => {
    const [seasons, courses, players] = await Promise.all([api.seasons(league.id), api.courses(league.id), api.players(league.id)]);
    const season = seasons[0];
    if (!season) return null;
    const [events, rounds, ledger] = await Promise.all([api.events(season.id), api.seasonRounds(season.id), api.seasonLedger(season.id)]);
    return { season, standings: buildStandings({ season, events, rounds, ledger, layouts: allLayouts(courses), players }) };
  }, [league.id]);

  const rules = data.data ? asBestBall(data.data.season.rules) : null;
  const hasMoney = !!rules && (rules.match.stake > 0 || rules.presses.enabled || rules.skins.enabled || rules.ctp.enabled);
  const [sort, setSort] = useState<SortKey | null>(null);
  const sortKey: SortKey = sort ?? (hasMoney ? 'money' : 'average');
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
    { key: 'average', label: 'Average', show: true },
    { key: 'wins', label: 'Wins', show: true },
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
              <th>W-L-H</th>
              {rules?.skins.enabled && <th>Skins</th>}
              {rules?.ctp.enabled && <th>CTP</th>}
              {hasMoney && <th>Money</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Row key={r.playerId} r={r} rank={i + 1} open={open === r.playerId} onToggle={() => setOpen(open === r.playerId ? null : r.playerId)}
                skins={!!rules?.skins.enabled} ctp={!!rules?.ctp.enabled} money={hasMoney} />
            ))}
          </tbody>
        </table>
      </section>
      <p className="small muted">Avg is the average score, with strokes over par in brackets. Last 4 is strokes over par over the last four rounds; 🔥 means the last four are at least half a stroke better than the season average. Tap a golfer for their weekly scores.</p>

      <section className="card stack">
        <div className="row between">
          <h2>Season awards so far</h2>
          {!showAwards && <ProLock />}
        </div>
        {showAwards ? (
          standings.awards.length ? (
            <ul className="awards">
              {standings.awards.map((a) => (
                <li key={a.key}>
                  <strong>{a.title}</strong>
                  <span>{a.winners.map((id) => rows.find((r) => r.playerId === id)?.name ?? '?').join(', ')}</span>
                  <span className="small muted">{AWARD_UNITS[a.key]?.(a.value)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="small muted">Awards appear as golfers play enough rounds.</p>
        ) : (
          <p className="small muted">Pro leagues get running awards (low average, skins leader, CTP king, money leader and more) and an end-of-season awards page.</p>
        )}
      </section>
    </div>
  );
}

function Row({ r, rank, open, onToggle, skins, ctp, money }: { r: StandingRow; rank: number; open: boolean; onToggle: () => void; skins: boolean; ctp: boolean; money: boolean }) {
  const cols = 6 + (skins ? 1 : 0) + (ctp ? 1 : 0) + (money ? 1 : 0);
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
        <td>{r.wins}-{r.losses}-{r.halves}</td>
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
          </td>
        </tr>
      )}
    </>
  );
}
