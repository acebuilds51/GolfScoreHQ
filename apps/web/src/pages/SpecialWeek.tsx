import type { FormatRules, ScrambleRules } from '@golfscorehq/engine';
import { useState } from 'react';
import { ErrorText, ProLock } from '../components/ui';
import { api } from '../lib/backend';
import { DEFAULT_HANDICAPS } from '../lib/handicaps';
import { useAction, useLeague } from '../lib/hooks';
import { formFromRules, handicapRules, rulesFromForm, type SideGameForm } from '../lib/scoring';
import type { LeagueEvent } from '../lib/types';

/** A scramble week like OCBC's: the team prize, skins that carry over, no CTP money. */
const SCRAMBLE_WEEK_FORM: Partial<SideGameForm> = {
  format: 'scramble', payouts: '120',
  skinsEnabled: true, skinsPot: '130', skinsTieRule: 'carryover',
  ctpEnabled: false, ctpAmount: '0',
  hcpSkins: 'gross',
};

/**
 * Commissioner control on an upcoming week: play it as a scramble (one team
 * score per hole) instead of the season's format, e.g. a mid-season or
 * end-of-season scramble. Stored as the week's rules override.
 */
export function SpecialWeek({ event, seasonRules, hasGroups, onChanged }: {
  event: LeagueEvent; seasonRules: FormatRules; hasGroups: boolean; onChanged: () => void;
}) {
  const { league } = useLeague();
  const allowed = league.features.includes('all_formats') && league.features.includes('side_games');
  const special = event.rulesOverride ?? null;
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useAction();

  const save = async (rules: ScrambleRules | null) => {
    const ok = await run(async () => { await api.updateEvent(event.id, { rulesOverride: rules }); return true; });
    if (ok) { setEditing(false); onChanged(); }
  };

  if (editing) return <ScrambleWeekForm initial={special} seasonRules={seasonRules} busy={busy} error={error} onSave={save} onCancel={() => setEditing(false)} />;

  return (
    <section className="card stack">
      <div className="row between wrap">
        <strong>{special ? 'This week is a scramble' : 'Special week'}</strong>
        {!allowed && <ProLock />}
      </div>
      {!allowed ? (
        <p className="small muted">Pro leagues can make any week a scramble (or another special format) with its own prize money and skins.</p>
      ) : hasGroups ? (
        <p className="small muted">Groups have already started this week, so its format can't change now.</p>
      ) : special ? (
        <div className="row wrap">
          <button className="btn btn-sm" disabled={busy} onClick={() => setEditing(true)}>Change scramble settings</button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save(null)}>Back to the regular format</button>
        </div>
      ) : (
        <>
          <p className="small muted">Playing a scramble this week? Each group plays as one team and enters one score per hole.</p>
          <div><button className="btn btn-sm" onClick={() => setEditing(true)}>Make this a scramble week</button></div>
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

function ScrambleWeekForm({ initial, seasonRules, busy, error, onSave, onCancel }: {
  initial: FormatRules | null; seasonRules: FormatRules; busy: boolean; error: string | null;
  onSave: (r: ScrambleRules) => void; onCancel: () => void;
}) {
  // Start from the week's saved scramble, else OCBC-style defaults using the season's handicap settings.
  const seasonHcp = { ...DEFAULT_HANDICAPS, ...handicapRules(seasonRules) };
  const [form, setForm] = useState<SideGameForm>(() =>
    initial ? formFromRules(initial) : { ...formFromRules(seasonRules), ...SCRAMBLE_WEEK_FORM, hcpEnabled: seasonHcp.enabled } as SideGameForm,
  );
  const set = (patch: Partial<SideGameForm>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <form
      className="card stack"
      onSubmit={(e) => { e.preventDefault(); onSave(rulesFromForm({ ...form, format: 'scramble' }) as ScrambleRules); }}
    >
      <h3>Scramble week</h3>
      <p className="small muted">Each group is a team. Everyone hits, the team picks the best shot, and the group enters one score per hole.</p>
      <label className="inline">
        Team prize money by place ($)
        <input value={form.payouts} placeholder="120" onChange={(e) => set({ payouts: e.target.value })} />
        <span className="small muted">1st, 2nd… separated by commas. Each team's prize is split evenly among its players.</span>
      </label>
      <label className="check-row"><input type="checkbox" checked={form.skinsEnabled} onChange={(e) => set({ skinsEnabled: e.target.checked })} /> Team skins</label>
      {form.skinsEnabled && (
        <>
          <label className="inline">Skins pot ($)<input inputMode="decimal" value={form.skinsPot} onChange={(e) => set({ skinsPot: e.target.value })} /></label>
          <label className="inline">
            When the low score ties
            <select value={form.skinsTieRule} onChange={(e) => set({ skinsTieRule: e.target.value as SideGameForm['skinsTieRule'] })}>
              <option value="carryover">Carries over to the next hole</option>
              <option value="noSkin">No skin — pot split among skins won</option>
            </select>
          </label>
        </>
      )}
      <label className="check-row"><input type="checkbox" checked={form.ctpEnabled} onChange={(e) => set({ ctpEnabled: e.target.checked })} /> Closest to the pin on par 3s</label>
      {form.ctpEnabled && (
        <label className="inline">CTP per par 3 ($)<input inputMode="decimal" value={form.ctpAmount} onChange={(e) => set({ ctpAmount: e.target.value })} /></label>
      )}
      <label className="check-row"><input type="checkbox" checked={form.hcpEnabled} onChange={(e) => set({ hcpEnabled: e.target.checked })} /> Net scramble (team handicap)</label>
      {form.hcpEnabled && (
        <>
          <p className="small muted">Team handicap: 25%, 20%, 15% and 10% of the players' course handicaps, lowest first (35% and 15% for a twosome).</p>
          <label className="inline">
            Skins
            <select value={form.hcpSkins} onChange={(e) => set({ hcpSkins: e.target.value as SideGameForm['hcpSkins'] })}>
              <option value="gross">Gross</option>
              <option value="net">Net (with the team's strokes)</option>
            </select>
          </label>
        </>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save scramble week'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
