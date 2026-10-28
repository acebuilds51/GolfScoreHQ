import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorText, ProLock, PageSkeleton } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync, useLeague } from '../lib/hooks';
import type { FormatRules } from '@golfscorehq/engine';
import {
  allLayouts, BASIC_FORMATS, describeRules, fmtDate, FORMAT_NAMES, formFromRules, handicapsFromForm, layoutForWeek, nextDate,
  OCBC_STYLE_FORM, plainRules, rulesFromForm, type FormatKey, type SideGameForm,
} from '../lib/scoring';

const FORMAT_HELP: Record<FormatKey, string> = {
  bestBallMatch: 'Two teams of two in each group. Each hole goes to the team with the lowest single score.',
  strokePlay: 'Everyone plays their own ball against the whole league. Lowest total wins the week.',
  stableford: 'Points on every hole: 2 for par, 3 for birdie, 1 for bogey, 0 for double or worse. Most points wins, and one bad hole never ruins the night.',
  scramble: 'Each group is a team playing the best shot every time, with one score per hole. Lowest team total wins. (For a single scramble week in another format, use the week page.)',
};
import { isCommissioner, type Season } from '../lib/types';
import { SeasonTeeTimes } from './TeeSheetPanel';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function PlayPage() {
  const { league } = useLeague();
  const commish = isCommissioner(league.role);
  const data = useAsync(async () => {
    const [seasons, courses] = await Promise.all([api.seasons(league.id), api.courses(league.id)]);
    const season = seasons[0] ?? null;
    const events = season ? await api.events(season.id) : [];
    return { season, courses, events };
  }, [league.id]);
  const [editingRules, setEditingRules] = useState(false);

  if (data.error) return <div className="page"><ErrorText>{data.error}</ErrorText></div>;
  if (!data.data) return <PageSkeleton />;
  const { season, courses, events } = data.data;

  if (!season) {
    return (
      <div className="page stack">
        {commish ? (
          courses.length === 0 ? (
            <EmptyState title="Add your course first">
              <p className="muted">The season needs a course to play. <Link to="../courses">Add your course</Link>, then come back here.</p>
            </EmptyState>
          ) : (
            <SeasonForm onSaved={data.reload} />
          )
        ) : (
          <EmptyState title="The season isn't set up yet">
            <p className="muted">Your commissioner will set it up. Weeks and scoring show up here.</p>
          </EmptyState>
        )}
      </div>
    );
  }

  const layouts = allLayouts(courses);
  const nextWeek = (events.at(-1)?.weekNumber ?? 0) + 1;

  return (
    <div className="page stack">
      <section className="card stack">
        <div className="row between wrap">
          <div>
            <h2>{season.name || `${season.year} season`}</h2>
            <p className="small muted">
              {season.leagueDay != null ? `${DAYS[season.leagueDay]}s` : ''}
              {season.startDate ? ` · starting ${fmtDate(season.startDate)}` : ''}
            </p>
          </div>
          {commish && !editingRules && <button className="btn btn-ghost btn-sm" onClick={() => setEditingRules(true)}>Edit format</button>}
        </div>
        {editingRules ? (
          <SeasonForm season={season} onSaved={() => { setEditingRules(false); data.reload(); }} onCancel={() => setEditingRules(false)} />
        ) : (
          <p className="small">{describeRules(season.rules).join(' · ')}</p>
        )}
      </section>

      <SeasonTeeTimes season={season} />

      <section className="card flush">
        <div className="row between pad wrap">
          <h2>Weeks</h2>
          {commish && <AddWeek season={season} weekNumber={nextWeek} courses={courses} onAdded={data.reload} />}
        </div>
        {events.length === 0 ? (
          <EmptyState title="No weeks yet">{commish && <p className="muted">Add week 1 to start scoring.</p>}</EmptyState>
        ) : (
          <ul className="list">
            {[...events].reverse().map((e) => {
              const l = layouts.find((x) => x.id === e.layoutId);
              return (
                <li key={e.id}>
                  <Link className="list-row link-row" to={`../week/${e.id}`}>
                    <div className="grow">
                      <strong>Week {e.weekNumber}</strong>{e.rulesOverride && <span className="badge badge-pro"> {e.rulesOverride.format === 'scramble' ? 'Scramble' : 'Special'}</span>}
                      <div className="small muted">{[fmtDate(e.eventDate), l ? `${l.courseName} · ${l.name}` : 'No course picked'].filter(Boolean).join(' · ')}</div>
                    </div>
                    <span className={`badge ${e.status === 'settled' ? 'badge-ok' : 'badge-neutral'}`}>
                      {e.status === 'settled' ? 'Final' : e.status === 'rainout' ? 'Rainout' : 'Open'}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function AddWeek({ season, weekNumber, courses, onAdded }: { season: Season; weekNumber: number; courses: Parameters<typeof layoutForWeek>[0]; onAdded: () => void }) {
  const { league } = useLeague();
  const { busy, error, run } = useAction();
  return (
    <div className="stack" style={{ gap: 4 }}>
      <button
        className="btn btn-primary btn-sm"
        disabled={busy}
        onClick={async () => {
          const ok = await run(async () => {
            await api.createEvent(league.id, season.id, { weekNumber, eventDate: nextDate(season.startDate, weekNumber), layoutId: layoutForWeek(courses, weekNumber) });
            return true;
          });
          if (ok) onAdded();
        }}
      >
        Add week {weekNumber}
      </button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function SeasonForm({ season, onSaved, onCancel }: { season?: Season; onSaved: () => void; onCancel?: () => void }) {
  const { league } = useLeague();
  const pro = league.features.includes('side_games');
  const allFormats = league.features.includes('all_formats');
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(season?.year ?? (new Date().getMonth() >= 8 ? thisYear + 1 : thisYear)));
  const [name, setName] = useState(season?.name ?? '');
  const [leagueDay, setLeagueDay] = useState(String(season?.leagueDay ?? 4));
  const [startDate, setStartDate] = useState(season?.startDate ?? '');
  const [form, setForm] = useState<SideGameForm>(season ? formFromRules(season.rules) : OCBC_STYLE_FORM);
  const { busy, error, setError, run } = useAction();
  const set = (patch: Partial<SideGameForm>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const y = Number(year);
        if (!(y >= 2020 && y <= 2100)) return setError('Enter the season year, e.g. 2027.');
        if (!allFormats && !BASIC_FORMATS.includes(form.format)) return setError(`${FORMAT_NAMES[form.format]} needs GolfScoreHQ Pro.`);
        // Handicaps are on every plan; side games and money need Pro.
        const rules: FormatRules = pro ? rulesFromForm(form) : { ...plainRules(form.format), handicaps: handicapsFromForm(form) } as FormatRules;
        const ok = await run(async () => {
          if (season) await api.updateSeasonRules(season.id, rules);
          else await api.createSeason(league.id, { year: y, name: name.trim(), rules, startDate: startDate || null, leagueDay: Number(leagueDay) });
          return true;
        });
        if (ok) onSaved();
      }}
    >
      {!season && (
        <>
          <h2>Set up the season</h2>
          <div className="grid four">
            <label>Year<input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} /></label>
            <label>Name (optional)<input placeholder="2027 season" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label>
              League night
              <select value={leagueDay} onChange={(e) => setLeagueDay(e.target.value)}>
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </label>
            <label>First week<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          </div>
        </>
      )}

      <div className="subcard stack">
        <div className="stack">
          <strong>Format</strong>
          <div className="format-picks" role="radiogroup" aria-label="Format">
            {(Object.keys(FORMAT_NAMES) as FormatKey[]).map((f) => {
              const locked = !allFormats && !BASIC_FORMATS.includes(f);
              return (
                <label key={f} className={`format-pick${form.format === f ? ' on' : ''}${locked ? ' locked' : ''}`}>
                  <input type="radio" name="format" value={f} checked={form.format === f} disabled={locked} onChange={() => { set({ format: f }); setError(null); }} />
                  <span className="grow">
                    <strong>{FORMAT_NAMES[f]}</strong>{locked && <> <ProLock /></>}
                    <span className="small muted block">{FORMAT_HELP[f]}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {season && form.format !== season.rules.format && <p className="small warn">Changing the format mid-season also changes how earlier weeks count in the standings. Money already posted doesn't change.</p>}
        </div>
        <div className="row between wrap">
          <strong>Side games and money</strong>
          {!pro && <ProLock />}
        </div>
        {!pro && <p className="small muted">Free leagues track scores and results. Pro adds {form.format === 'bestBallMatch' ? 'the match bet, presses' : 'prize money by place'}, skins and closest to the pin, settled automatically.</p>}
        <fieldset className="side-games" disabled={!pro}>
          {form.format === 'bestBallMatch' ? (
            <>
              <label className="inline">
                Match bet per man ($)
                <input inputMode="decimal" value={form.matchStake} onChange={(e) => set({ matchStake: e.target.value })} />
              </label>
              <label className="check-row"><input type="checkbox" checked={form.pressesEnabled} onChange={(e) => set({ pressesEnabled: e.target.checked })} /> Presses</label>
              {form.pressesEnabled && (
                <label className="inline">Press per man ($)<input inputMode="decimal" value={form.pressStake} onChange={(e) => set({ pressStake: e.target.value })} /></label>
              )}
            </>
          ) : (
            <label className="inline">
              {form.format === 'scramble' ? 'Team prize money each week by place ($)' : 'Prize money each week by place ($)'}
              <input value={form.payouts} placeholder="30, 20, 10" onChange={(e) => set({ payouts: e.target.value })} />
              <span className="small muted">
                1st, 2nd, 3rd… separated by commas. Leave it empty for no prize money. {form.format === 'scramble'
                  ? "Teams tied for a place split the money for the places they cover, and each team's prize is split among its players."
                  : 'Golfers tied for a place split the money for the places they cover.'}
              </span>
            </label>
          )}
          <label className="check-row"><input type="checkbox" checked={form.skinsEnabled} onChange={(e) => set({ skinsEnabled: e.target.checked })} /> Skins across the whole league</label>
          {form.skinsEnabled && (
            <>
              <label className="inline">Skins pot each week ($)<input inputMode="decimal" value={form.skinsPot} onChange={(e) => set({ skinsPot: e.target.value })} /></label>
              <label className="inline">
                When the low score ties
                <select value={form.skinsTieRule} onChange={(e) => set({ skinsTieRule: e.target.value as SideGameForm['skinsTieRule'] })}>
                  <option value="noSkin">No skin — pot split among skins won</option>
                  <option value="carryover">Carries over to the next hole</option>
                </select>
              </label>
            </>
          )}
          <label className="check-row"><input type="checkbox" checked={form.ctpEnabled} onChange={(e) => set({ ctpEnabled: e.target.checked })} /> Closest to the pin on par 3s</label>
          {form.ctpEnabled && (
            <label className="inline">CTP per par 3 ($)<input inputMode="decimal" value={form.ctpAmount} onChange={(e) => set({ ctpAmount: e.target.value })} /></label>
          )}
        </fieldset>
      </div>

      <div className="subcard stack">
        <strong>Handicaps</strong>
        <label className="check-row"><input type="checkbox" checked={form.hcpEnabled} onChange={(e) => set({ hcpEnabled: e.target.checked })} /> Play with handicaps (net scoring)</label>
        {form.hcpEnabled ? (
          <>
            <label className="inline">
              Handicaps come from
              <select value={form.hcpSource} onChange={(e) => set({ hcpSource: e.target.value as SideGameForm['hcpSource'] })}>
                <option value="ghinFirst">GHIN index if entered, otherwise calculated from league rounds</option>
                <option value="ghin">Only the GHIN index I enter</option>
                <option value="league">Only calculated from league rounds</option>
              </select>
            </label>
            {form.format !== 'scramble' && (
              <label className="inline">
                Percent of handicap used
                <input inputMode="numeric" value={form.hcpAllowance} onChange={(e) => set({ hcpAllowance: e.target.value.replace(/\D/g, '') })} />
                <span className="small muted">
                  {form.format === 'bestBallMatch'
                    ? '100 = full handicap. 90% is common for 2-man best ball, 85% for USGA four-ball.'
                    : '100 = full handicap. 95% is the USGA recommendation for individual stroke play and Stableford.'}
                </span>
              </label>
            )}
            {form.format === 'scramble' ? (
              <p className="small muted">Each team gets a team handicap: 25%, 20%, 15% and 10% of its players' course handicaps, lowest first (35% and 15% for a twosome).</p>
            ) : form.format === 'bestBallMatch' ? (
              <label className="inline">
                Strokes in the match
                <select value={form.hcpMatch} onChange={(e) => set({ hcpMatch: e.target.value as SideGameForm['hcpMatch'] })}>
                  <option value="offLow">Off the low man (the best player in the group plays scratch)</option>
                  <option value="full">Everyone gets their full strokes</option>
                  <option value="gross">No strokes in the match (gross)</option>
                </select>
              </label>
            ) : (
              <p className="small muted">The leaderboard and places use net scores: each golfer gets their own strokes.</p>
            )}
            <label className="inline">
              Skins
              <select value={form.hcpSkins} onChange={(e) => set({ hcpSkins: e.target.value as SideGameForm['hcpSkins'] })}>
                <option value="gross">Gross (no strokes)</option>
                <option value="net">{form.format === 'scramble' ? "Net (the team's strokes)" : "Net (each golfer's own strokes)"}</option>
              </select>
            </label>
            <p className="small muted">Each golfer's strokes are set when their group starts, so changing a handicap later never changes a finished week. Enter GHIN numbers and indexes on the Roster page.</p>
          </>
        ) : (
          <p className="small muted">Off: everyone plays gross, no strokes given.</p>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : season ? 'Save format' : 'Start the season'}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
