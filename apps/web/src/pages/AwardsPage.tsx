import { courseHoleStats, type Award, type HoleAverage } from '@golfscorehq/engine';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { EmptyState, ErrorText, PageSkeleton, ProLock } from '../components/ui';
import { AWARD_ICONS, AWARD_UNITS, MONEY_AWARDS } from '../lib/awards';
import { brandLogo } from '../lib/brand';
import { useAction, useAsync, useLeague } from '../lib/hooks';
import { loadSeasonData, useSeasonChoice, type SeasonData } from '../lib/seasonData';
import { SeasonPicker, seasonLabel } from '../components/SeasonPicker';
import { drawAwardsCard, saveImage, shareImage, type CardBrand } from '../lib/shareCards';
import { fmtToPar } from '../lib/standings';
import { seesSeasonMoney } from '../lib/types';

/** Pro: the season's awards, a picture to share, and which holes played hardest. */
export function AwardsPage() {
  const { league } = useLeague();
  const pro = league.features.includes('awards');
  const { seasonId } = useSeasonChoice();
  const data = useAsync(async () => (pro ? loadSeasonData(league.id, seasonId) : null), [league.id, pro, seasonId]);

  if (!pro) {
    return (
      <div className="page stack">
        <div className="row between"><h2>Season awards</h2><ProLock feature="awards" /></div>
        <p className="muted">Pro leagues get an awards page that updates every week: low average, best round, skins leader, CTP king, birdie machine, most improved and more, plus a picture to share and the course's hardest and easiest holes.</p>
        <div><Link className="btn" to="../settings">See plans</Link></div>
      </div>
    );
  }
  if (data.error) return <div className="page"><ErrorText>{data.error}</ErrorText></div>;
  if (data.loading && !data.data) return <PageSkeleton />;
  if (!data.data) {
    return <div className="page"><EmptyState title="No awards yet"><p className="muted">Awards fill in once the first week is settled.</p></EmptyState></div>;
  }
  if (data.data.standings.weeksCounted === 0) {
    return (
      <div className="page stack">
        <div className="row between wrap">
          <h2>{seasonLabel(data.data.season)} awards</h2>
          <SeasonPicker seasons={data.data.seasons} current={data.data.season} />
        </div>
        <EmptyState title="No awards yet"><p className="muted">Awards fill in once the first week is settled.</p></EmptyState>
      </div>
    );
  }
  return <Awards data={data.data} />;
}

function Awards({ data }: { data: SeasonData }) {
  const { league } = useLeague();
  const { season, seasons, standings, players } = data;
  const { query } = useSeasonChoice();
  const names = useMemo(() => new Map(players.map((p) => [p.id, p.displayName])), [players]);
  const label = seasonLabel(season);
  const who = (a: Award) => a.winners.map((id) => names.get(id) ?? '?').join(', ');
  // The money leader is left out when the league keeps season money from golfers.
  const awards = seesSeasonMoney(league) ? standings.awards : standings.awards.filter((a) => !MONEY_AWARDS.includes(a.key));

  return (
    <div className="page stack">
      <div>
        <Link to={`../standings${query}`} className="small">← Standings</Link>
        <div className="row between wrap">
          <h2>{label} awards</h2>
          <SeasonPicker seasons={seasons} current={season} />
        </div>
        <p className="small muted">Through {standings.weeksCounted} settled week{standings.weeksCounted === 1 ? '' : 's'}. Average awards need enough full rounds to qualify; ties share an award.</p>
      </div>

      {awards.length === 0 ? (
        <p className="muted">Awards appear as golfers play enough rounds.</p>
      ) : (
        <ul className="award-cards">
          {awards.map((a) => (
            <li key={a.key} className="award-card">
              <span className="award-icon" aria-hidden="true">{AWARD_ICONS[a.key]}</span>
              <div className="grow">
                <div className="small muted">{a.title}</div>
                <div className="award-winners">
                  {a.winners.map((id, i) => <span key={id}>{i > 0 && ', '}<Link to={`../player/${id}${query}`}>{names.get(id) ?? '?'}</Link></span>)}
                </div>
                {AWARD_UNITS[a.key](a.value) && <div className="small">{AWARD_UNITS[a.key](a.value)}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {awards.length > 0 && <ShareAwards awards={awards} who={who} seasonLabel={label} />}

      <CourseStats holes={courseHoleStats(standings.played)} />
      <p className="small muted">Scramble weeks are team scores, so they don't count toward anyone's awards for scoring. {league.features.includes('side_games') ? 'Their money and skins do.' : ''}</p>
    </div>
  );
}

function ShareAwards({ awards, who, seasonLabel }: { awards: Award[]; who: (a: Award) => string; seasonLabel: string }) {
  const { league } = useLeague();
  const [withMoney, setWithMoney] = useState(false);
  const [picture, setPicture] = useState<{ blob: Blob; url: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  useEffect(() => () => { if (picture) URL.revokeObjectURL(picture.url); }, [picture]);

  const branded = league.features.includes('branding');
  const brand: CardBrand = {
    leagueName: league.name,
    color: (branded && league.brandColor) || '#14365c',
    accent: (branded && league.accentColor) || '#1d9e75',
    logoUrl: brandLogo(league),
  };
  const file = `${league.slug.replace(/[^a-z0-9-]/g, '')}-season-awards.png`;

  async function make() {
    setNote(null);
    const items = awards
      .filter((a) => withMoney || !MONEY_AWARDS.includes(a.key))
      .map((a) => ({ icon: AWARD_ICONS[a.key], title: a.title, winners: who(a), value: AWARD_UNITS[a.key](a.value) }));
    const blob = await run(() => drawAwardsCard(items, brand, seasonLabel));
    if (!blob) return;
    if (picture) URL.revokeObjectURL(picture.url);
    setPicture({ blob, url: URL.createObjectURL(blob) });
  }

  return (
    <section className="card stack share-week">
      <h3>Share the awards</h3>
      <div className="row wrap">
        <button className="btn btn-primary" disabled={busy} onClick={make}><Icon name="trophy" size={18} /> Make the awards picture</button>
      </div>
      {awards.some((a) => MONEY_AWARDS.includes(a.key)) && (
        <label className="check-row small">
          <input type="checkbox" checked={withMoney} onChange={(e) => setWithMoney(e.target.checked)} />
          Include the money leader
        </label>
      )}
      <ErrorText>{error}</ErrorText>
      {picture && (
        <div className="share-preview stack">
          <img src={picture.url} alt="Season awards picture" />
          <div className="row wrap">
            <button
              className="btn btn-primary"
              onClick={async () => {
                const r = await shareImage(picture.blob, file, `${league.name}: ${seasonLabel} awards`);
                setNote(r === 'saved' ? 'Saved. Add it to a Facebook post from your photos or downloads.' : r === 'shared' ? 'Shared.' : null);
              }}
            >
              <Icon name="share" size={18} /> Share
            </button>
            <button className="btn" onClick={() => { saveImage(picture.blob, file); setNote('Saved.'); }}><Icon name="download" size={18} /> Save</button>
            <button className="btn btn-ghost" onClick={() => setPicture(null)}>Close</button>
          </div>
          {note && <p className="small good">{note}</p>}
        </div>
      )}
    </section>
  );
}

/** Hardest and easiest holes for the league on each nine (holes played at least four times). */
function CourseStats({ holes }: { holes: HoleAverage[] }) {
  const byLayout = new Map<string, HoleAverage[]>();
  for (const h of holes.filter((x) => x.played >= 4)) byLayout.set(h.layoutName, [...(byLayout.get(h.layoutName) ?? []), h]);
  if (!byLayout.size) return null;
  const line = (h: HoleAverage) => (
    <div key={`${h.layoutId}-${h.holeNumber}`} className="row between small">
      <span>#{h.holeNumber} <span className="muted">par {h.par}{h.strokeIndex ? ` · hcp ${h.strokeIndex}` : ''}</span></span>
      <span><strong>{h.averageScore}</strong> <span className="muted">({fmtToPar(h.averageToPar)}) · {h.birdiesOrBetter} birdie{h.birdiesOrBetter === 1 ? '' : 's'}</span></span>
    </div>
  );
  return (
    <section className="card stack">
      <h3>How the course played</h3>
      <p className="small muted">The league's average on each hole this season.</p>
      {[...byLayout].map(([name, list]) => (
        <div key={name} className="stack">
          <strong>{name}</strong>
          <div className="grid two">
            <div><div className="small muted">Hardest</div>{list.slice(0, 3).map(line)}</div>
            <div><div className="small muted">Easiest</div>{[...list].reverse().slice(0, 3).map(line)}</div>
          </div>
        </div>
      ))}
    </section>
  );
}
