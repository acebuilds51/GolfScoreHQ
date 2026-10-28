import { headToHead, playerProfile, type HoleAverage, type PlayerProfile, type ScoreMix } from '@golfscorehq/engine';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, ErrorText, PageSkeleton, ProLock } from '../components/ui';
import { AWARD_ICONS, MONEY_AWARDS } from '../lib/awards';
import { fmtIndex } from '../lib/handicaps';
import { useAsync, useLeague } from '../lib/hooks';
import { asBestBall, fmtMoney, individualRules, playsForMoney } from '../lib/scoring';
import { loadSeasonData, useSeasonChoice, type SeasonData } from '../lib/seasonData';
import { SeasonPicker, seasonLabel } from '../components/SeasonPicker';
import { fmtToPar, sortStandings, type StandingRow } from '../lib/standings';
import { seesSeasonMoney } from '../lib/types';

/** One golfer's season: the numbers everyone sees, plus Pro's deeper stats. */
export function PlayerPage() {
  const { playerId = '' } = useParams();
  const { league } = useLeague();
  const { seasonId } = useSeasonChoice();
  const data = useAsync(() => loadSeasonData(league.id, seasonId), [league.id, seasonId]);

  if (data.error) return <div className="page"><ErrorText>{data.error}</ErrorText></div>;
  if (data.loading && !data.data) return <PageSkeleton />;
  if (!data.data) return <div className="page"><EmptyState title="No season yet"><p className="muted">Stats appear once the season is set up and a week is settled.</p></EmptyState></div>;
  const player = data.data.players.find((p) => p.id === playerId);
  if (!player) return <div className="page muted">Golfer not found.</div>;
  return <PlayerStats data={data.data} playerId={playerId} />;
}

function PlayerStats({ data, playerId }: { data: SeasonData; playerId: string }) {
  const { league } = useLeague();
  const pro = league.features.includes('awards');
  const { season, standings, players, events, rounds } = data;
  const { query } = useSeasonChoice();
  const player = players.find((p) => p.id === playerId)!;
  const names = useMemo(() => new Map(players.map((p) => [p.id, p.displayName])), [players]);
  const rules = season.rules;
  const individual = individualRules(rules) !== null;
  const hasMoney = playsForMoney(rules) && seesSeasonMoney(league);
  const ranked = sortStandings(standings.rows, hasMoney ? 'money' : rules.format === 'stableford' ? 'points' : 'average');
  const rank = ranked.findIndex((r) => r.playerId === playerId) + 1;
  const row: StandingRow | undefined = standings.rows.find((r) => r.playerId === playerId);
  const profile = useMemo(() => playerProfile(standings.played, playerId), [standings.played, playerId]);
  const h2h = useMemo(() => {
    if (rules.format !== 'bestBallMatch') return [];
    return Object.values(headToHead(standings.played, asBestBall(rules)))
      .filter((h) => h.playerA === playerId || h.playerB === playerId)
      .map((h) => {
        const mine = h.playerA === playerId;
        return { opponent: mine ? h.playerB : h.playerA, wins: mine ? h.aWins : h.bWins, losses: mine ? h.bWins : h.aWins, halves: h.halves };
      })
      .sort((a, b) => b.wins + b.losses + b.halves - (a.wins + a.losses + a.halves) || (names.get(a.opponent) ?? '').localeCompare(names.get(b.opponent) ?? ''));
  }, [standings.played, rules, playerId, names]);
  const myAwards = standings.awards.filter((a) => a.winners.includes(playerId) && (hasMoney || !MONEY_AWARDS.includes(a.key)));

  // Their rounds this season, newest first, with a link to each scorecard.
  const eventById = new Map(events.map((e) => [e.id, e]));
  const myRounds = rounds
    .filter((r) => r.players.some((p) => p.playerId === playerId) && eventById.has(r.eventId))
    .map((r) => ({ round: r, event: eventById.get(r.eventId)! }))
    .sort((a, b) => b.event.weekNumber - a.event.weekNumber);
  const weekScore = new Map((row?.weeks ?? []).map((w) => [w.week, w]));

  return (
    <div className="page stack player-page">
      <div>
        <Link to={`../standings${query}`} className="small">← Standings</Link>
        <div className="row between wrap">
          <h2>{player.displayName}{player.isSub && <span className="badge badge-neutral"> Sub</span>}</h2>
          <SeasonPicker seasons={data.seasons} current={season} />
        </div>
        <p className="small muted">
          {seasonLabel(season)}{rank ? ` · ${ordinal(rank)} in the standings` : ''}
          {player.handicapIndex != null ? ` · Handicap Index ${fmtIndex(player.handicapIndex)}` : ''}
        </p>
        {myAwards.length > 0 && (
          <div className="week-chips">{myAwards.map((a) => <span key={a.key} className="chip">{AWARD_ICONS[a.key]} {a.title}</span>)}</div>
        )}
      </div>

      {!row ? (
        <EmptyState title="No settled rounds yet"><p className="muted">Stats fill in after this golfer plays a week that's been settled.</p></EmptyState>
      ) : (
        <>
          <div className="stat-tiles">
            <Tile label="Rounds" value={String(row.rounds)} />
            <Tile label="Average" value={row.average !== null ? String(row.average) : '—'} sub={row.averageToPar !== null ? fmtToPar(row.averageToPar) : undefined} />
            <Tile label="Best" value={row.best ? String(row.best.score) : '—'} sub={row.best ? `week ${row.best.week}` : undefined} />
            <Tile label="Last 4" value={fmtToPar(row.last4AverageToPar)} sub={row.hot ? '🔥 on a run' : undefined} />
            {rules.format === 'stableford' && <Tile label="Points" value={String(row.points)} sub={row.averagePoints !== null ? `${row.averagePoints} a round` : undefined} />}
            {individual || rules.format === 'scramble'
              ? <Tile label="Weeks won" value={String(row.weekWins)} sub={`${row.top3} top-3`} />
              : <Tile label="Matches" value={`${row.wins}-${row.losses}-${row.halves}`} sub="won-lost-halved" />}
            {rules.skins.enabled && <Tile label="Skins" value={String(row.skins)} />}
            {rules.ctp.enabled && <Tile label="CTPs" value={String(row.ctps)} />}
            {hasMoney && <Tile label="Money" value={`${row.money > 0 ? '+' : row.money < 0 ? '−' : ''}${fmtMoney(Math.abs(row.money))}`} tone={row.money > 0 ? 'good' : row.money < 0 ? 'warn' : undefined} />}
          </div>

          {pro ? (
            <>
              {row.weeks.length >= 2 && (
                <section className="card stack">
                  <h3>Week by week</h3>
                  <TrendChart weeks={row.weeks} average={row.averageToPar} />
                </section>
              )}
              {profile.mix.holes > 0 && <MixCard mix={profile.mix} byPar={profile.byPar} />}
              {(profile.bestHole || profile.worstHole) && <HolesCard profile={profile} />}
              {h2h.length > 0 && (
                <section className="card stack">
                  <h3>Head to head</h3>
                  <p className="small muted">Matches against each golfer they've played on the other side.</p>
                  <div className="scroll-x">
                    <table className="money">
                      <thead><tr><th>Against</th><th>Won</th><th>Lost</th><th>Halved</th></tr></thead>
                      <tbody>
                        {h2h.map((h) => (
                          <tr key={h.opponent}>
                            <td className="name"><Link to={`../player/${h.opponent}${query}`}>{names.get(h.opponent) ?? '?'}</Link></td>
                            <td className={h.wins > h.losses ? 'good' : ''}>{h.wins}</td>
                            <td className={h.losses > h.wins ? 'warn' : ''}>{h.losses}</td>
                            <td>{h.halves}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          ) : (
            <section className="card stack">
              <div className="row between"><h3>More stats</h3><ProLock /></div>
              <p className="small muted">Pro leagues see each golfer's week-by-week chart, birdie and bogey mix, par-3/4/5 scoring, best and worst holes, and head-to-head records.</p>
            </section>
          )}
        </>
      )}

      {myRounds.length > 0 && (
        <section className="card flush">
          <h3 className="pad">Rounds</h3>
          <ul className="list">
            {myRounds.map(({ round, event }) => {
              const w = weekScore.get(event.weekNumber);
              const scramble = (event.rulesOverride ?? season.rules).format === 'scramble';
              return (
                <li key={round.id}>
                  <Link className="list-row link-row" to={`../round/${round.id}`}>
                    <div className="grow">
                      <strong>Week {event.weekNumber}</strong>
                      <div className="small muted">{scramble ? 'Scramble (team score)' : event.status === 'settled' ? 'Final' : event.status === 'rainout' ? 'Rainout' : 'Not settled yet'}</div>
                    </div>
                    {w && <span><strong>{w.score}</strong> <span className="muted small">{fmtToPar(w.toPar)}</span></span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className={`num stat-value${tone ? ` ${tone}` : ''}`}>{value}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

/** Strokes over par each week, with the season average as a dashed line. Lower (better) is higher up. */
export function TrendChart({ weeks, average }: { weeks: { week: number; toPar: number; score: number }[]; average: number | null }) {
  const W = 320, H = 140, PX = 28, PY = 16;
  const vals = weeks.map((w) => w.toPar);
  const lo = Math.min(...vals, average ?? Infinity, 0) - 1;
  const hi = Math.max(...vals, average ?? -Infinity, 0) + 1;
  const x = (i: number) => PX + (weeks.length === 1 ? 0 : (i * (W - PX * 2)) / (weeks.length - 1));
  const y = (v: number) => PY + ((v - lo) / (hi - lo)) * (H - PY * 2);
  const pts = weeks.map((w, i) => `${x(i)},${y(w.toPar)}`).join(' ');
  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Strokes over par by week: ${weeks.map((w) => `week ${w.week} ${fmtToPar(w.toPar)}`).join(', ')}`}>
      <line x1={PX} x2={W - PX} y1={y(0)} y2={y(0)} className="trend-par" />
      <text x={4} y={y(0) + 4} className="trend-label">E</text>
      {average !== null && <line x1={PX} x2={W - PX} y1={y(average)} y2={y(average)} className="trend-avg" />}
      <polyline points={pts} className="trend-line" />
      {weeks.map((w, i) => (
        <g key={w.week}>
          <circle cx={x(i)} cy={y(w.toPar)} r={4} className={w.toPar < 0 ? 'trend-dot under' : 'trend-dot'} />
          <text x={x(i)} y={H - 2} className="trend-label" textAnchor="middle">{w.week}</text>
        </g>
      ))}
    </svg>
  );
}

const MIX: { key: keyof Omit<ScoreMix, 'holes'>; label: string }[] = [
  { key: 'eagles', label: 'Eagles+' }, { key: 'birdies', label: 'Birdies' }, { key: 'pars', label: 'Pars' }, { key: 'bogeys', label: 'Bogeys' }, { key: 'doubles', label: 'Double+' },
];

function MixCard({ mix, byPar }: { mix: ScoreMix; byPar: PlayerProfile['byPar'] }) {
  const pct = (n: number) => Math.round((n / mix.holes) * 100);
  return (
    <section className="card stack">
      <h3>How the holes went</h3>
      <div className="mix-bar" role="img" aria-label={MIX.map((m) => `${m.label} ${mix[m.key]}`).join(', ')}>
        {MIX.filter((m) => mix[m.key] > 0).map((m) => <span key={m.key} className={`mix-${m.key}`} style={{ flexGrow: mix[m.key] }} title={`${m.label}: ${mix[m.key]}`} />)}
      </div>
      <div className="mix-legend small">
        {MIX.map((m) => <span key={m.key}><i className={`mix-${m.key}`} /> {m.label} <strong>{mix[m.key]}</strong> <span className="muted">{pct(mix[m.key])}%</span></span>)}
      </div>
      {byPar.length > 0 && (
        <div className="stat-tiles small-tiles">
          {byPar.map((p) => <Tile key={p.par} label={`Par ${p.par}s`} value={fmtToPar(p.averageToPar)} sub={`${p.holes} holes`} />)}
        </div>
      )}
    </section>
  );
}

function HolesCard({ profile }: { profile: PlayerProfile }) {
  const hole = (h: HoleAverage) => `${h.layoutName} #${h.holeNumber} (par ${h.par})`;
  return (
    <section className="card stack">
      <h3>Best and worst holes</h3>
      {profile.bestHole && <p className="small"><strong>Best:</strong> {hole(profile.bestHole)} — averages {profile.bestHole.averageScore} ({fmtToPar(profile.bestHole.averageToPar)}) over {profile.bestHole.played} rounds</p>}
      {profile.worstHole && profile.worstHole.averageToPar > (profile.bestHole?.averageToPar ?? -Infinity) && (
        <p className="small"><strong>Toughest:</strong> {hole(profile.worstHole)} — averages {profile.worstHole.averageScore} ({fmtToPar(profile.worstHole.averageToPar)}) over {profile.worstHole.played} rounds</p>
      )}
    </section>
  );
}
