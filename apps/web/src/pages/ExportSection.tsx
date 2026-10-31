import { useState } from 'react';
import { ErrorText, ProLock } from '../components/ui';
import { api } from '../lib/backend';
import { download, exportName, moneyCsv, scoresCsv, standingsCsv } from '../lib/exportSeason';
import { useAction, useAsync, useLeague } from '../lib/hooks';
import { loadSeasonData } from '../lib/seasonData';

const FILES = [
  { what: 'scores', label: 'Scores', help: 'every golfer’s card, hole by hole', make: scoresCsv },
  { what: 'money', label: 'Money', help: 'every skin, match, press and closest to the pin posted', make: moneyCsv },
  { what: 'standings', label: 'Standings', help: 'the season table', make: standingsCsv },
] as const;

/** Export (Pro): download a season as spreadsheets (CSV opens in Excel, Numbers or Google Sheets). */
export function ExportSection() {
  const { league } = useLeague();
  const allowed = league.features.includes('export');
  const seasons = useAsync(() => api.seasons(league.id), [league.id]);
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const chosen = seasonId ?? seasons.data?.[0]?.id ?? null;

  return (
    <section className="card stack">
      <div className="row between">
        <h2>Download your league</h2>
        {!allowed && <ProLock feature="export" />}
      </div>
      <p className="small muted">Spreadsheets of a season, to keep or to open in Excel or Google Sheets.</p>
      {allowed && seasons.data && (seasons.data.length === 0 ? (
        <p className="small muted">Nothing to download yet: add a season first.</p>
      ) : (
        <>
          {seasons.data.length > 1 && (
            <label>
              Season
              <select value={chosen ?? ''} onChange={(e) => setSeasonId(e.target.value)}>
                {seasons.data.map((s) => <option key={s.id} value={s.id}>{s.name || s.year}</option>)}
              </select>
            </label>
          )}
          <ul className="list">
            {FILES.map((f) => (
              <li key={f.what} className="list-row">
                <span className="grow"><strong>{f.label}</strong> <span className="small muted">{f.help}</span></span>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(async () => {
                  const data = await loadSeasonData(league.id, chosen);
                  if (!data) throw new Error('That season has nothing in it yet.');
                  download(exportName(league.slug, data.season.name || String(data.season.year), f.what), f.make(data));
                })}>Download</button>
              </li>
            ))}
          </ul>
          <ErrorText>{error}</ErrorText>
        </>
      ))}
    </section>
  );
}
