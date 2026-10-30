import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorText, PageSkeleton, ProLock } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync, useLeague } from '../lib/hooks';
import { nextLeagueDay } from '../lib/schedule';
import { describeRules, FORMAT_NAMES, layoutForWeek, BASIC_FORMATS, type FormatKey, type SideGameForm } from '../lib/scoring';
import {
  answersForUs, buildPlan, checkAnswers, DAYS, defaultAnswers, duesCents, planFeatures, rosterFrom, seasonRules, seasonWeeks, teeTimes,
  type PlanFeatures, type SetupAnswers, type SetupContext,
} from '../lib/setupWizard';
import { fmtTeeTime } from '../lib/teeSheet';
import { isCommissioner } from '../lib/types';
import { AddCourse } from './CoursesPage';
import { FORMAT_HELP } from './PlayPage';

const STEPS = ['Your course', 'How you play', 'When you play', 'Your golfers', 'Check and build'] as const;

/**
 * "Set up my league": a few plain questions, then the app builds the season,
 * its weeks, tee times, dues and roster. Or hand the answers to us instead.
 */
export function SetupWizardPage() {
  const { league } = useLeague();
  const plan = planFeatures(league.features);
  const ctx = useAsync(async () => {
    const [courses, seasons, players] = await Promise.all([api.courses(league.id), api.seasons(league.id), api.players(league.id)]);
    return { courses, season: seasons[0] ?? null, players };
  }, [league.id], { fresh: true });
  const [step, setStep] = useState(0);
  const [a, setA] = useState<SetupAnswers>(defaultAnswers);
  const [built, setBuilt] = useState(false);

  if (!isCommissioner(league.role)) return <div className="page muted">Only commissioners can set up the league.</div>;
  if (!ctx.data) return ctx.error ? <div className="page"><ErrorText>{ctx.error}</ErrorText></div> : <PageSkeleton />;
  const { courses, season, players } = ctx.data;
  const context: SetupContext = { hasCourse: courses.length > 0, hasSeason: !!season, existingNames: players.map((p) => p.displayName) };
  const set = (patch: Partial<SetupAnswers>) => setA((x) => ({ ...x, ...patch }));
  const setForm = (patch: Partial<SideGameForm>) => setA((x) => ({ ...x, form: { ...x.form, ...patch } }));
  const next = () => { setStep((s) => Math.min(STEPS.length - 1, s + 1)); window.scrollTo({ top: 0 }); };
  const back = () => { setStep((s) => Math.max(0, s - 1)); window.scrollTo({ top: 0 }); };

  if (built) return <Built />;

  return (
    <div className="page stack wizard">
      <div>
        <h1>Set up {league.name}</h1>
        <p className="muted">Answer a few questions and GolfScoreHQ builds your season, weeks, tee times and roster. Change anything later.</p>
      </div>
      <ol className="wizard-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
            <button type="button" className="linkish" disabled={i > step} onClick={() => setStep(i)}>{i < step ? '✓ ' : `${i + 1}. `}{s}</button>
          </li>
        ))}
      </ol>

      {step === 0 && (courses.length ? (
        <section className="card stack">
          <h2>Your course</h2>
          <p>✓ {courses.map((c) => c.name).join(', ')}</p>
          <p className="small muted">Need another? Add it any time from More → Courses.</p>
          <Nav onNext={next} />
        </section>
      ) : (
        <div className="stack">
          <p className="muted">Search for the course you play and the scorecard fills in, or type the pars from your scorecard.</p>
          <AddCourse onDone={() => { ctx.reload(); next(); }} onCancel={next} cancelLabel="Skip for now" />
        </div>
      ))}

      {step === 1 && (season ? <HaveSeason season={season} onBack={back} onNext={next} /> : (
        <HowYouPlay a={a} plan={plan} set={set} setForm={setForm} onBack={back} onNext={next} />
      ))}

      {step === 2 && (season ? <HaveSeason season={season} onBack={back} onNext={next} /> : (
        <WhenYouPlay a={a} plan={plan} set={set} onBack={back} onNext={next} />
      ))}

      {step === 3 && <YourGolfers a={a} set={set} existing={context.existingNames} onBack={back} onNext={next} />}

      {step === 4 && <Review a={a} plan={plan} ctx={context} courses={courses} onBack={back} onBuilt={() => setBuilt(true)} />}
    </div>
  );
}

function Nav({ onBack, onNext, nextLabel = 'Next' }: { onBack?: () => void; onNext: () => void; nextLabel?: string }) {
  return (
    <div className="row">
      <button type="button" className="btn btn-primary" onClick={onNext}>{nextLabel}</button>
      {onBack && <button type="button" className="btn btn-ghost" onClick={onBack}>Back</button>}
    </div>
  );
}

function HaveSeason({ season, onBack, onNext }: { season: { year: number; rules: Parameters<typeof describeRules>[0] }; onBack: () => void; onNext: () => void }) {
  return (
    <section className="card stack">
      <h2>Your {season.year} season is already set up</h2>
      <p className="small">{describeRules(season.rules).join(' · ')}</p>
      <p className="small muted">Change the format, side games, weeks or tee times on the <Link to="../play">Play tab</Link>.</p>
      <Nav onBack={onBack} onNext={onNext} />
    </section>
  );
}

function YesNo({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <fieldset className="yes-no" disabled={disabled}>
      <legend>{label}</legend>
      <label className={value ? 'on' : ''}><input type="radio" checked={value} onChange={() => onChange(true)} /> Yes</label>
      <label className={!value ? 'on' : ''}><input type="radio" checked={!value} onChange={() => onChange(false)} /> No</label>
    </fieldset>
  );
}

function Dollars({ label, value, onChange, hint, disabled }: { label: string; value: string; onChange: (v: string) => void; hint?: string; disabled?: boolean }) {
  return (
    <label className="inline">
      {label}
      <span className="prefixed dollars"><span>$</span><input inputMode="decimal" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} /></span>
      {hint && <span className="small muted">{hint}</span>}
    </label>
  );
}

type StepProps = { a: SetupAnswers; plan: PlanFeatures; set: (p: Partial<SetupAnswers>) => void; onBack: () => void; onNext: () => void };

function HowYouPlay({ a, plan, set, setForm, onBack, onNext }: StepProps & { setForm: (p: Partial<SideGameForm>) => void }) {
  const f = a.form;
  const match = f.format === 'bestBallMatch';
  const locked = !plan.sideGames;
  return (
    <section className="card stack">
      <h2>How you play</h2>
      <div className="stack">
        <strong>What do you play each week?</strong>
        <div className="format-picks" role="radiogroup" aria-label="Format">
          {(Object.keys(FORMAT_NAMES) as FormatKey[]).map((k) => {
            const needsPro = !plan.allFormats && !BASIC_FORMATS.includes(k);
            return (
              <label key={k} className={`format-pick${f.format === k ? ' on' : ''}${needsPro ? ' locked' : ''}`}>
                <input type="radio" name="format" checked={f.format === k} disabled={needsPro} onChange={() => setForm({ format: k })} />
                <span className="grow"><strong>{FORMAT_NAMES[k]}</strong>{needsPro && <> <ProLock /></>}<span className="small muted block">{FORMAT_HELP[k]}</span></span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="subcard stack">
        <YesNo label="Do you play with handicaps?" value={f.hcpEnabled} onChange={(v) => setForm({ hcpEnabled: v })} />
        {f.hcpEnabled && (
          <label className="inline">
            Where do the handicaps come from?
            <select value={f.hcpSource} onChange={(e) => setForm({ hcpSource: e.target.value as SideGameForm['hcpSource'] })}>
              <option value="ghinFirst">GHIN when a golfer has one, otherwise from league rounds</option>
              <option value="ghin">Only GHIN (I'll enter each golfer's index)</option>
              <option value="league">Worked out from our league rounds</option>
            </select>
          </label>
        )}
      </div>

      <div className="subcard stack">
        <div className="row between wrap"><strong>Side games and money</strong>{locked && <ProLock />}</div>
        {locked && <p className="small muted">Skins, closest to the pin and money need Pro. Answer anyway: we'll show them in your review, and you can turn them on after upgrading.</p>}
        {match && (
          <>
            <Dollars label="Bet on each match, per man (0 for none)" value={f.matchStake} onChange={(v) => setForm({ matchStake: v })} />
            <YesNo label="Do you play presses?" value={f.pressesEnabled} onChange={(v) => setForm({ pressesEnabled: v })} />
            {f.pressesEnabled && <Dollars label="Each press, per man" value={f.pressStake} onChange={(v) => setForm({ pressStake: v })} />}
          </>
        )}
        {!match && (
          <label className="inline">
            Prize money each week by place
            <input value={f.payouts} placeholder="30, 20, 10" onChange={(e) => setForm({ payouts: e.target.value })} />
            <span className="small muted">1st, 2nd, 3rd… in dollars, separated by commas. Leave it empty for none.</span>
          </label>
        )}
        <YesNo label="Do you play skins across the whole league?" value={f.skinsEnabled} onChange={(v) => setForm({ skinsEnabled: v })} />
        {f.skinsEnabled && (
          <>
            <Dollars label="Skins pot each week" value={f.skinsPot} onChange={(v) => setForm({ skinsPot: v })} />
            <label className="inline">
              When two golfers tie for low on a hole
              <select value={f.skinsTieRule} onChange={(e) => setForm({ skinsTieRule: e.target.value as SideGameForm['skinsTieRule'] })}>
                <option value="noSkin">Nobody wins it; the pot is split among the skins that were won</option>
                <option value="carryover">It carries over to the next hole</option>
              </select>
            </label>
          </>
        )}
        <YesNo label="Closest to the pin on the par 3s?" value={f.ctpEnabled} onChange={(v) => setForm({ ctpEnabled: v })} />
        {f.ctpEnabled && <Dollars label="Paid on each par 3" value={f.ctpAmount} onChange={(v) => setForm({ ctpAmount: v })} />}
        <Dollars label="Do golfers pay you up front for the season? (0 for no)" value={a.dues} onChange={(v) => set({ dues: v })} hint="Skins and closest-to-the-pin money collected before the season. You'll get a checklist of who's paid." />
        {match && (Number(f.matchStake) > 0 || f.pressesEnabled) && (
          <fieldset className="segmented stack">
            <legend className="small"><strong>Who handles the match and press money?</strong></legend>
            <label className={a.matchMoney === 'golfers' ? 'on' : ''}><input type="radio" checked={a.matchMoney === 'golfers'} onChange={() => set({ matchMoney: 'golfers' })} /> The golfers settle it with each other</label>
            <label className={a.matchMoney === 'commissioner' ? 'on' : ''}><input type="radio" checked={a.matchMoney === 'commissioner'} onChange={() => set({ matchMoney: 'commissioner' })} /> It goes through me, with the skins and CTP</label>
          </fieldset>
        )}
      </div>
      <Nav onBack={onBack} onNext={onNext} />
    </section>
  );
}

function WhenYouPlay({ a, plan, set, onBack, onNext }: StepProps) {
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const { all } = seasonWeeks(a);
  const times = teeTimes(a, plan);
  const toggle = (d: string) => set({ skipped: a.skipped.includes(d) ? a.skipped.filter((x) => x !== d) : [...a.skipped, d] });
  let week = 0;
  return (
    <section className="card stack">
      <h2>When you play</h2>
      <div className="grid three">
        <label>Season<input inputMode="numeric" value={a.year} onChange={(e) => set({ year: e.target.value.replace(/\D/g, '') })} /></label>
        <label>
          League night
          <select value={a.leagueDay} onChange={(e) => set({ leagueDay: Number(e.target.value), firstWeek: '', skipped: [] })}>
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </label>
        <label>How many weeks<input inputMode="numeric" value={a.weeks} onChange={(e) => set({ weeks: e.target.value.replace(/\D/g, '') })} /></label>
      </div>
      <label>
        First league night
        <div className="row wrap">
          <input type="date" value={a.firstWeek} onChange={(e) => set({ firstWeek: e.target.value, skipped: [] })} />
          {!a.firstWeek && <button type="button" className="btn btn-sm" onClick={() => set({ firstWeek: nextLeagueDay(a.year > todayIso.slice(0, 4) ? `${a.year}-04-15` : todayIso, a.leagueDay) })}>Suggest one</button>}
        </div>
        <span className="small muted">Not sure yet? Leave it empty and add the weeks later on the Play tab.</span>
      </label>
      {all.length > 0 && (
        <>
          <p className="small muted">Untick any night you're not playing (a holiday, a course event) and the rest move along a week.</p>
          <div className="week-dates">
            {all.map((d) => {
              const off = a.skipped.includes(d);
              if (!off) week += 1;
              return (
                <label key={d} className={`check-row week-date${off ? ' off' : ''}`}>
                  <input type="checkbox" checked={!off} onChange={() => toggle(d)} />
                  <span>{off ? 'Off' : `Week ${week}`} <span className="muted">· {new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></span>
                </label>
              );
            })}
          </div>
        </>
      )}

      <div className="subcard stack">
        <div className="row between wrap"><strong>Tee times</strong>{!plan.teeSheet && <ProLock />}</div>
        <div className="grid three">
          <label>First group tees off<input type="time" value={a.teeFirst} disabled={!plan.teeSheet} onChange={(e) => set({ teeFirst: e.target.value })} /></label>
          <label>Minutes apart<input inputMode="numeric" value={a.teeEvery} disabled={!plan.teeSheet} onChange={(e) => set({ teeEvery: e.target.value.replace(/\D/g, '') })} /></label>
          <label>How many groups<input inputMode="numeric" value={a.teeCount} disabled={!plan.teeSheet} placeholder="6" onChange={(e) => set({ teeCount: e.target.value.replace(/\D/g, '') })} /></label>
        </div>
        {times.length > 0 && <p className="small">{times.map(fmtTeeTime).join(' · ')}</p>}
        <p className="small muted">{plan.teeSheet ? 'Golfers join groups themselves on the tee sheet. Leave it empty if you don\'t use tee times.' : 'The tee sheet, where golfers join groups themselves, comes with Pro.'}</p>
      </div>
      <Nav onBack={onBack} onNext={onNext} />
    </section>
  );
}

function YourGolfers({ a, set, existing, onBack, onNext }: { a: SetupAnswers; set: (p: Partial<SetupAnswers>) => void; existing: string[]; onBack: () => void; onNext: () => void }) {
  const { players, skipped } = rosterFrom(a, existing);
  const subs = players.filter((p) => p.isSub).length;
  return (
    <section className="card stack">
      <h2>Your golfers</h2>
      {existing.length > 0 && <p className="small">{existing.length} golfer{existing.length === 1 ? ' is' : 's are'} already on your roster. Add anyone else below.</p>}
      <label>
        Paste your golfers, one per line
        <textarea rows={10} value={a.roster} onChange={(e) => set({ roster: e.target.value })}
          placeholder={'Mike Walsh, mike@example.com, 248-555-0100\nChris Lee, sub\nSmith, John'} />
        <span className="small muted">Copy the names column (with emails and phones if you have them) straight from your spreadsheet. Put "sub" after anyone who only fills in.</span>
      </label>
      {players.length > 0 && <p className="small good">✓ {players.length - subs} golfer{players.length - subs === 1 ? '' : 's'}{subs ? ` and ${subs} sub${subs === 1 ? '' : 's'}` : ''}: {players.map((p) => p.displayName).join(', ')}</p>}
      {skipped.length > 0 && <ul className="small warn">{skipped.map((s) => <li key={s.line}>{s.line}: {s.reason}</li>)}</ul>}
      <Nav onBack={onBack} onNext={onNext} nextLabel={players.length ? 'Next' : 'Skip for now'} />
    </section>
  );
}

function Review({ a, plan, ctx, courses, onBack, onBuilt }: { a: SetupAnswers; plan: PlanFeatures; ctx: SetupContext; courses: Parameters<typeof layoutForWeek>[0]; onBack: () => void; onBuilt: () => void }) {
  const { league, reloadLeague } = useLeague();
  const nav = useNavigate();
  const [progress, setProgress] = useState<string | null>(null);
  const { busy, error, setError, run } = useAction();
  const steps = buildPlan(a, plan, ctx);
  const lockedGames = !plan.sideGames && !ctx.hasSeason && (a.form.skinsEnabled || a.form.ctpEnabled || Number(a.form.matchStake) > 0 || a.form.pressesEnabled);

  async function build() {
    const problem = checkAnswers(a, plan, ctx.hasSeason);
    if (problem) return setError(problem);
    const ok = await run(async () => {
      if (!ctx.hasSeason) {
        setProgress('Starting the season…');
        const rules = seasonRules(a, plan);
        const seasonId = await api.createSeason(league.id, { year: Number(a.year), name: '', rules, startDate: a.firstWeek || null, leagueDay: a.leagueDay });
        const times = teeTimes(a, plan);
        if (times.length) { setProgress('Setting tee times…'); await api.setSeasonTeeTimes(seasonId, times); }
        const dues = duesCents(a, plan);
        if (dues) await api.setSeasonDues(seasonId, dues);
        if (plan.payments && a.matchMoney !== (league.matchMoney ?? 'golfers')) await api.updateLeague(league.id, { matchMoney: a.matchMoney });
        const { dates } = seasonWeeks(a);
        for (const [i, date] of dates.entries()) {
          setProgress(`Adding week ${i + 1} of ${dates.length}…`);
          await api.createEvent(league.id, seasonId, { weekNumber: i + 1, eventDate: date, layoutId: layoutForWeek(courses, i + 1) });
        }
      }
      const { players } = rosterFrom(a, ctx.existingNames);
      if (players.length) { setProgress('Adding your golfers…'); await api.addPlayers(league.id, players); }
      return true;
    });
    setProgress(null);
    if (ok) { reloadLeague(); onBuilt(); }
  }

  return (
    <section className="card stack">
      <h2>Check and build</h2>
      {steps.length ? (
        <>
          <p>When you tap Build, GolfScoreHQ will:</p>
          <ol className="review-list">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </>
      ) : <p className="muted">There's nothing new to build from your answers. Go back and add golfers, or head to the Play tab.</p>}
      {lockedGames && <p className="small warn">Your league is on Free, so the side games and money you described aren't included. Upgrade in Settings, then turn them on with "Edit format" on the Play tab.</p>}
      <ErrorText>{error}</ErrorText>
      <div className="row wrap">
        <button className="btn btn-primary" disabled={busy || !steps.length} onClick={build}>{progress ?? 'Build my league'}</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onBack}>Back</button>
      </div>
      <div className="subcard stack">
        <strong>Rather have us do it?</strong>
        <p className="small muted">
          Send these answers with your spreadsheets and last season's results, and we'll set it all up for you, including handicaps and history.
          {!league.features.includes('setup_service') && ' Included with Pro.'}
        </p>
        <div>
          <button type="button" className="btn btn-sm" onClick={() => nav('../setup', { state: { notes: answersForUs(a, plan, ctx) } })}>Send my answers to GolfScoreHQ</button>
        </div>
      </div>
    </section>
  );
}

function Built() {
  return (
    <div className="page stack wizard">
      <section className="card stack">
        <h1>Your league is ready ⛳</h1>
        <p>Next, get your golfers into the app so they can score, see results and join the tee sheet.</p>
        <ol className="review-list">
          <li><Link to="../roster">Invite your golfers</Link>: a personal link for each, or one text for everyone.</li>
          <li><Link to="../play">Look over the season</Link>: weeks, courses and tee times.</li>
          <li><Link to="../settings">Settings</Link>: your Venmo for dues, the league code, who sees what.</li>
        </ol>
        <div><Link className="btn btn-primary" to="..">Go to the league</Link></div>
      </section>
    </div>
  );
}
