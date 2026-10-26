import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorText, ProLock, PageSkeleton } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync, useLeague } from '../lib/hooks';
import { allLayouts, basicRules, describeRules, fmtDate, formFromRules, layoutForWeek, nextDate, OCBC_STYLE_FORM, rulesFromForm, type SideGameForm } from '../lib/scoring';
import { isCommissioner, type Season } from '../lib/types';

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
                      <strong>Week {e.weekNumber}</strong>
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
        const rules = pro ? rulesFromForm(form) : basicRules();
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
        <div>
          <strong>Format</strong>
          <p className="small muted">2 vs 2 best ball match: each hole goes to the team with the lowest single score. More formats are coming.</p>
        </div>
        <div className="row between wrap">
          <strong>Side games and money</strong>
          {!pro && <ProLock />}
        </div>
        {!pro && <p className="small muted">Free leagues track scores and match results. Pro adds the match bet, presses, skins and closest to the pin, settled automatically.</p>}
        <fieldset className="side-games" disabled={!pro}>
          <label className="inline">
            Match bet per man ($)
            <input inputMode="decimal" value={form.matchStake} onChange={(e) => set({ matchStake: e.target.value })} />
          </label>
          <label className="check-row"><input type="checkbox" checked={form.pressesEnabled} onChange={(e) => set({ pressesEnabled: e.target.checked })} /> Presses</label>
          {form.pressesEnabled && (
            <label className="inline">Press per man ($)<input inputMode="decimal" value={form.pressStake} onChange={(e) => set({ pressStake: e.target.value })} /></label>
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
      <ErrorText>{error}</ErrorText>
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : season ? 'Save format' : 'Start the season'}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
