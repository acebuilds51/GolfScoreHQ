import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorText, PageSkeleton, ProLock } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync, useLeague } from '../lib/hooks';
import {
  guessColumns, isOcbcExport, matchRoster, parseTable, planFromOcbc, planFromTable, planSummary,
  type ColumnRole, type ImportPlan,
} from '../lib/importer';
import { runImport, type ImportResult } from '../lib/importRunner';
import { allLayouts, describeRules } from '../lib/scoring';
import { isXlsx, xlsxSheetNames, xlsxSheetToTsv } from '../lib/sheetFile';
import { isCommissioner, type Season } from '../lib/types';

const ROLE_LABELS: { value: ColumnRole; label: string }[] = [
  { value: 'ignore', label: '— skip —' },
  { value: 'week', label: 'Week' },
  { value: 'date', label: 'Date' },
  { value: 'golfer', label: 'Golfer' },
  { value: 'tee', label: 'Tee time / group' },
  { value: 'team', label: 'Team (A/B)' },
  { value: 'nine', label: 'Nine (front/back)' },
  { value: 'total', label: 'Total (not imported)' },
  ...Array.from({ length: 18 }, (_, i) => ({ value: `hole:${i + 1}` as ColumnRole, label: `Hole ${i + 1}` })),
];

const NEW_SEASON = '__new__';

/**
 * Import past rounds from a spreadsheet or the old OCBC app's export.
 * Commissioners (and GolfScoreHQ staff doing a setup) on Pro.
 */
export function ImportPage() {
  const { league } = useLeague();
  const commish = isCommissioner(league.role);
  const pro = league.features.includes('setup_service');
  const data = useAsync(async () => {
    const [seasons, courses, players] = await Promise.all([api.seasons(league.id), api.courses(league.id), api.players(league.id)]);
    return { seasons, layouts: allLayouts(courses), players };
  }, [league.id]);

  if (!commish) return <div className="page muted">Only commissioners can import scores.</div>;
  if (!pro) {
    return (
      <div className="page stack">
        <div className="row between"><h2>Import past rounds</h2><ProLock /></div>
        <p className="muted">Bring last season's scores in from a spreadsheet so standings, stats and handicaps start with history. Included with GolfScoreHQ Pro, or <Link to="../setup">we can do it for you</Link>.</p>
      </div>
    );
  }
  if (data.error) return <div className="page"><ErrorText>{data.error}</ErrorText></div>;
  if (!data.data) return <PageSkeleton />;
  const { seasons, layouts, players } = data.data;
  if (!layouts.length) return <div className="page"><p className="muted">Add your course first (<Link to="../courses">Courses</Link>), so scores have holes to go on.</p></div>;
  if (!seasons.length) return <div className="page"><p className="muted">Set up the season first on the <Link to="../play">Play</Link> tab; past seasons can then be added here.</p></div>;
  return <Importer seasons={seasons} layouts={layouts} players={players} onDone={data.reload} />;
}

function Importer({ seasons, layouts, players, onDone }: {
  seasons: Season[]; layouts: ReturnType<typeof allLayouts>; players: { id: string; displayName: string }[]; onDone: () => void;
}) {
  const { league } = useLeague();
  const [seasonId, setSeasonId] = useState(seasons[0]!.id);
  const [newYear, setNewYear] = useState(String(seasons[0]!.year - 1));
  const [text, setText] = useState('');
  // An Excel file with more than one sheet: which one to import.
  const [workbook, setWorkbook] = useState<{ file: File; sheets: string[]; sheet: string } | null>(null);
  const [roles, setRoles] = useState<ColumnRole[] | null>(null);
  const [layoutId, setLayoutId] = useState(layouts[0]!.id);
  const [settle, setSettle] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const { busy, error, setError, run } = useAction();

  const ocbc = useMemo(() => isOcbcExport(text), [text]);
  const table = useMemo(() => (ocbc || !text.trim() ? [] : parseTable(text)), [text, ocbc]);
  const header = table[0] ?? [];
  const cols = roles && roles.length === header.length ? roles : guessColumns(header);
  const plan: ImportPlan | null = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return ocbc ? planFromOcbc(text, layouts) : planFromTable(table.slice(1), cols, layouts, layoutId);
    } catch (e) {
      return { weeks: [], names: [], subs: [], problems: [`That file couldn't be read: ${(e as Error).message}`] };
    }
  }, [text, ocbc, table, cols, layouts, layoutId]);
  const roster = matchRoster(plan?.names ?? [], players);
  const sum = plan ? planSummary(plan) : null;
  const targetSeason = seasons.find((s) => s.id === seasonId) ?? null;

  async function readFile(f: File) {
    setError(null);
    setWorkbook(null);
    if (isXlsx(f)) {
      try {
        const sheets = await xlsxSheetNames(f);
        if (sheets.length > 1) setWorkbook({ file: f, sheets, sheet: sheets[0]! });
        await loadSheet(f, sheets[0]!);
      } catch {
        setError("That Excel file couldn't be read. Save it as CSV and choose that file, or copy the cells and paste them below.");
      }
      return;
    }
    if (/\.(xls|ods|numbers)$/i.test(f.name)) {
      setError('Older Excel, Numbers and OpenOffice files: save it as .xlsx or CSV and choose that file, or copy the cells (including the header row) and paste them in the box below.');
      return;
    }
    setText(await f.text());
    setRoles(null);
    setResult(null);
  }

  async function loadSheet(f: File, sheet: string) {
    const tsv = await xlsxSheetToTsv(f, sheet);
    if (!tsv.trim()) setError(`The sheet "${sheet}" is empty.`);
    setText(tsv);
    setRoles(null);
    setResult(null);
  }

  async function go() {
    if (!plan || !sum?.weeks) return;
    setResult(null);
    const res = await run(async () => {
      let season = targetSeason;
      if (seasonId === NEW_SEASON) {
        const y = Number(newYear);
        if (!(y >= 2000 && y <= 2100)) throw new Error('Enter the year of the season you are importing.');
        if (seasons.some((s) => s.year === y)) throw new Error(`There's already a ${y} season; pick it above.`);
        const base = seasons[0]!;
        const id = await api.createSeason(league.id, { year: y, name: '', rules: base.rules, startDate: null, leagueDay: base.leagueDay });
        season = { ...base, id, year: y, name: '', startDate: null };
      }
      return runImport(api, { leagueId: league.id, season: season!, plan, layouts, settle }, setProgress);
    });
    setProgress(null);
    if (res) { setResult(res); onDone(); }
  }

  if (result) {
    return (
      <div className="page stack">
        <h2>Import finished</h2>
        <section className="card stack">
          <p>
            Added <strong>{result.weeksAdded.length}</strong> week{result.weeksAdded.length === 1 ? '' : 's'} with <strong>{result.groupsAdded}</strong> group{result.groupsAdded === 1 ? '' : 's'}
            {result.golfersAdded > 0 && <> and <strong>{result.golfersAdded}</strong> new golfer{result.golfersAdded === 1 ? '' : 's'}</>}.
            {result.settled.length > 0 && <> Settled {result.settled.length === result.weeksAdded.length ? 'all of them' : `weeks ${result.settled.join(', ')}`}.</>}
          </p>
          {result.weeksSkipped.length > 0 && <p className="small warn">Left alone because they already had scores: week {result.weeksSkipped.join(', ')}.</p>}
          {result.problems.map((p, i) => <p key={i} className="small warn">{p}</p>)}
          <div className="row wrap">
            <Link className="btn btn-primary" to="../standings">See the standings</Link>
            <Link className="btn" to="../play">Weeks</Link>
            <Link className="btn" to="../roster">Roster</Link>
            <button className="btn btn-ghost" onClick={() => { setResult(null); setText(''); }}>Import more</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page stack">
      <div>
        <h2>Import past rounds</h2>
        <p className="muted">Bring scores in from a spreadsheet (Excel, CSV or pasted cells): one row per golfer per round, with the week (or date), the golfer's name and a score for each hole. The old OCBC app's export works too. Nothing is saved until you press Import.</p>
      </div>

      <section className="card stack">
        <h3>1. Which season?</h3>
        <label className="inline">
          Season
          <select value={seasonId} onChange={(e) => setSeasonId(e.target.value)}>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name || `${s.year} season`}</option>)}
            <option value={NEW_SEASON}>A past season (new)</option>
          </select>
        </label>
        {seasonId === NEW_SEASON ? (
          <label className="inline">
            Year
            <input inputMode="numeric" value={newYear} onChange={(e) => setNewYear(e.target.value.replace(/\D/g, ''))} />
            <span className="small muted">Uses the same format and side games as {seasons[0]!.name || `the ${seasons[0]!.year} season`}.</span>
          </label>
        ) : targetSeason && <p className="small muted">{describeRules(targetSeason.rules).join(' · ')}</p>}
      </section>

      <section className="card stack">
        <h3>2. Your scores</h3>
        <label className="inline">
          Choose a file
          <input type="file" accept=".xlsx,.csv,.tsv,.txt,.json,.xls" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ''; }} />
          <span className="small muted">Excel (.xlsx), CSV or the old OCBC app's export.</span>
        </label>
        {workbook && (
          <label className="inline">
            Sheet
            <select value={workbook.sheet} onChange={(e) => { const sheet = e.target.value; setWorkbook({ ...workbook, sheet }); setError(null); void loadSheet(workbook.file, sheet); }}>
              {workbook.sheets.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        <label>
          …or paste from Excel or Google Sheets (include the header row)
          <textarea rows={8} className="mono" value={text} onChange={(e) => { setText(e.target.value); setRoles(null); }} placeholder={'Week\tGolfer\t1\t2\t3\t4\t5\t6\t7\t8\t9\n1\tAl Adams\t4\t3\t5\t4\t4\t5\t3\t4\t4'} />
        </label>
        <ErrorText>{error}</ErrorText>
        {ocbc && <p className="small good">This is the old OCBC app's export: teams, presses and closest-to-the-pin come across too.</p>}
      </section>

      {!ocbc && header.length > 0 && (
        <section className="card stack">
          <h3>3. What's in each column?</h3>
          <div className="scroll-x">
            <table className="money import-map">
              <thead><tr><th>Column</th><th>First row</th><th>Is</th></tr></thead>
              <tbody>
                {header.map((h, i) => (
                  <tr key={i}>
                    <td className="name">{h || `Column ${i + 1}`}</td>
                    <td className="muted">{table[1]?.[i] ?? ''}</td>
                    <td>
                      <select value={cols[i]} onChange={(e) => { const next = [...cols]; next[i] = e.target.value as ColumnRole; setRoles(next); }}>
                        {ROLE_LABELS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="inline">
            Course for weeks without a "nine" column
            <select value={layoutId} onChange={(e) => setLayoutId(e.target.value)}>
              {layouts.map((l) => <option key={l.id} value={l.id}>{l.courseName} · {l.name}</option>)}
            </select>
          </label>
        </section>
      )}

      {plan && (
        <section className="card stack">
          <h3>{ocbc ? '3' : '4'}. Check it over</h3>
          {sum && sum.weeks > 0 ? (
            <>
              <p>
                <strong>{sum.weeks}</strong> week{sum.weeks === 1 ? '' : 's'} · <strong>{sum.groups}</strong> group{sum.groups === 1 ? '' : 's'} · <strong>{sum.rounds}</strong> golfer rounds ·{' '}
                <strong>{plan.names.length}</strong> golfers ({plan.names.length - roster.missing.length} already on the roster)
              </p>
              {roster.missing.length > 0 && (
                <p className="small">New to the roster: {roster.missing.join(', ')}. <span className="muted">Check the spelling matches your roster, or they'll be added as new golfers.</span></p>
              )}
              <div className="scroll-x">
                <table className="money">
                  <thead><tr><th>Week</th><th>Course</th><th>Groups</th><th>Golfers</th></tr></thead>
                  <tbody>
                    {plan.weeks.map((w) => (
                      <tr key={w.week}>
                        <td>{w.week}{w.date ? <span className="muted small"> {w.date}</span> : ''}</td>
                        <td>{layouts.find((l) => l.id === w.layoutId)?.name ?? '?'}</td>
                        <td>{w.groups.length}</td>
                        <td className="small">{w.groups.map((g) => g.players.map((p) => p.name.split(' ')[0]).join('/')).join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : <p className="muted">Nothing to import yet.</p>}
          {plan.problems.map((p, i) => <p key={i} className="small warn">{p}</p>)}
          {sum && sum.weeks > 0 && (
            <>
              <label className="check-row">
                <input type="checkbox" checked={settle} onChange={(e) => setSettle(e.target.checked)} />
                Settle each imported week (posts skins, closest to the pin and money with the season's rules)
              </label>
              <p className="small muted">Weeks in this season that already have scores are left alone.</p>
              <div className="row wrap">
                <button className="btn btn-primary" disabled={busy} onClick={go}>{busy ? 'Importing…' : `Import ${sum.weeks} week${sum.weeks === 1 ? '' : 's'}`}</button>
                {progress && <span className="small muted">{progress}</span>}
              </div>
            </>
          )}
          <ErrorText>{error}</ErrorText>
        </section>
      )}
    </div>
  );
}
