import { useState } from 'react';
import { api } from '../lib/backend';
import { useAction, useAsync, useAuth, useLeague } from '../lib/hooks';
import { cleanHandles, handleProblem, payoutNote, paypalPayUrl, venmoPayUrl, weekPayouts, type WeekPayout } from '../lib/payouts';
import { fmtMoney } from '../lib/scoring';
import { isCommissioner, type LedgerRow, type LeagueEvent, type PayHandles, type Player, type Season } from '../lib/types';
import { ErrorText } from './ui';

const signed = (c: number) => (c > 0 ? `+${fmtMoney(c)}` : c < 0 ? `−${fmtMoney(-c)}` : '$0');
const EMPTY: PayHandles = { venmo: null, paypalMe: null, zelle: null };

/** Venmo / PayPal / Zelle for one golfer: the golfer's own, or filled in by a commissioner. */
export function PayHandlesForm({ playerId, initial, onSaved, compact = false }: { playerId: string; initial?: PayHandles; onSaved?: () => void; compact?: boolean }) {
  const { league } = useLeague();
  const [h, setH] = useState<PayHandles>(initial ?? EMPTY);
  const [done, setDone] = useState(false);
  const { busy, error, setError, run } = useAction();
  const set = (k: keyof PayHandles) => (e: React.ChangeEvent<HTMLInputElement>) => { setH({ ...h, [k]: e.target.value }); setDone(false); setError(null); };
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      const next = cleanHandles(h);
      const problem = handleProblem(next);
      if (problem) return setError(problem);
      const ok = await run(async () => { await api.savePayHandles(league.id, playerId, next); return true; });
      if (ok) { setH(next); setDone(true); onSaved?.(); }
    }}>
      <div className={compact ? 'grid three' : 'stack'}>
        <label>Venmo username<input value={h.venmo ?? ''} onChange={set('venmo')} placeholder="@your-venmo" autoCapitalize="none" /></label>
        <label>PayPal.me name<input value={h.paypalMe ?? ''} onChange={set('paypalMe')} placeholder="from paypal.me/yourname" autoCapitalize="none" /></label>
        <label>Zelle email or phone<input value={h.zelle ?? ''} onChange={set('zelle')} placeholder="you@example.com" /></label>
      </div>
      <div className="row">
        <button className="btn btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        {done && <span className="small good">Saved ✓</span>}
      </div>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

/** Home: where the commissioner sends your winnings. */
export function MyPayHandles({ players }: { players: Player[] }) {
  const { league } = useLeague();
  const { user } = useAuth();
  const mine = players.find((p) => p.active && p.userId && p.userId === user?.id);
  const handles = useAsync(async () => (mine ? (await api.payHandles(league.id))[mine.id] ?? EMPTY : null), [league.id, mine?.id], { fresh: true });
  const [open, setOpen] = useState(false);
  if (!mine || !league.features.includes('payments') || !handles.data) return null;
  const h = handles.data;
  const set = [h.venmo && `Venmo @${h.venmo}`, h.paypalMe && `PayPal ${h.paypalMe}`, h.zelle && `Zelle ${h.zelle}`].filter(Boolean);
  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>How you get paid</h2>
        {!open && <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>{set.length ? 'Change' : 'Add'}</button>}
      </div>
      {!open && <p className="small muted">{set.length ? <>The commissioner pays your skins and closest-to-the-pin winnings to: <strong>{set.join(' · ')}</strong></> : 'Add your Venmo, PayPal or Zelle so the commissioner can pay your skins and closest-to-the-pin winnings in a tap. Only the commissioners see it.'}</p>}
      {open && <PayHandlesForm playerId={mine.id} initial={h} onSaved={() => { setOpen(false); handles.reload(); }} />}
    </section>
  );
}

/**
 * A settled week's money. Commissioners: everyone the league owes (or who owes
 * the league), with Venmo / PayPal filled in and a Paid tick. Golfers: their
 * own winnings and whether they've been paid, and their match result.
 */
export function WeekPayouts({ event, ledger, names }: { event: LeagueEvent; ledger: LedgerRow[]; names: Map<string, string> }) {
  const { league } = useLeague();
  const { user } = useAuth();
  const commish = isCommissioner(league.role);
  const matchMoney = league.matchMoney ?? 'golfers';
  const payouts = weekPayouts(ledger, matchMoney);
  const extra = useAsync(async () => {
    const [paid, handles, players] = await Promise.all([api.payoutsPaid(event.id), api.payHandles(league.id), api.players(league.id)]);
    return { paid, handles, players };
  }, [event.id, league.id], { fresh: true });
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  if (!league.features.includes('payments') || !payouts.length) return null;
  const d = extra.data;

  if (!commish) {
    const mine = d?.players.find((p) => p.userId && p.userId === user?.id);
    const p = mine && payouts.find((x) => x.playerId === mine.id);
    if (!p) return null;
    const paid = d?.paid[p.playerId];
    return (
      <div className="subcard stack my-money">
        <strong>Your money this week</strong>
        {p.cents !== 0 && (
          <div className="row between wrap">
            <span>{p.cents > 0 ? 'From the commissioner' : 'You owe the commissioner'}: <strong>{fmtMoney(Math.abs(p.cents))}</strong></span>
            {paid ? <span className="badge badge-ok">{p.cents > 0 ? 'Paid' : 'Received'} ✓</span> : <span className="badge badge-neutral">{p.cents > 0 ? 'Not paid yet' : 'Not received yet'}</span>}
          </div>
        )}
        {p.matchCents !== null && p.matchCents !== 0 && (
          <div className="small">Match and presses: <strong className={p.matchCents > 0 ? 'good' : 'warn'}>{signed(p.matchCents)}</strong> <span className="muted">· settled with your group</span></div>
        )}
      </div>
    );
  }

  const owed = payouts.filter((p) => p.cents !== 0);
  const done = owed.filter((p) => d?.paid[p.playerId]);
  const left = owed.filter((p) => !d?.paid[p.playerId] && p.cents > 0).reduce((s, p) => s + p.cents, 0);
  return (
    <div className="stack payouts">
      <div className="row between wrap">
        <h3>Pay out week {event.weekNumber}</h3>
        <span className="small muted">{done.length} of {owed.length} done{left > 0 ? ` · ${fmtMoney(left)} left to pay` : ''}</span>
      </div>
      {matchMoney === 'golfers' && <p className="small muted">Skins, closest to the pin and prizes. Match and press money is settled between the golfers.</p>}
      <ErrorText>{error ?? extra.error}</ErrorText>
      <ul className="list">
        {owed.map((p) => (
          <PayoutRow
            key={p.playerId} p={p} name={names.get(p.playerId) ?? '?'} note={payoutNote(league.name, event.weekNumber, p)}
            handles={d?.handles[p.playerId]} paid={d?.paid[p.playerId]} busy={busy || !d}
            editing={editing === p.playerId} onEdit={() => setEditing(editing === p.playerId ? null : p.playerId)}
            onSaved={() => { setEditing(null); extra.reload(); }}
            onTick={async (on) => { await run(() => api.markPayoutPaid(event.id, p.playerId, p.cents, on)); extra.reload(); }}
          />
        ))}
      </ul>
      <p className="small muted">The buttons open Venmo or PayPal with the golfer, amount and note filled in; you press Pay there. Tick each one off when it's done and the golfer sees it's paid.</p>
    </div>
  );
}

function PayoutRow({ p, name, note, handles, paid, busy, editing, onEdit, onSaved, onTick }: {
  p: WeekPayout; name: string; note: string; handles?: PayHandles; paid?: { amountCents: number }; busy: boolean;
  editing: boolean; onEdit: () => void; onSaved: () => void; onTick: (on: boolean) => void;
}) {
  const paying = p.cents > 0;
  const venmo = paying ? venmoPayUrl(handles?.venmo, p.cents, note) : null;
  const paypal = paying ? paypalPayUrl(handles?.paypalMe, p.cents) : null;
  const changed = paid && paid.amountCents !== p.cents;
  return (
    <li className="list-row stack">
      <div className="row between wrap">
        <span><strong>{name}</strong> <span className={paying ? 'good' : 'warn'}>{paying ? fmtMoney(p.cents) : `owes ${fmtMoney(-p.cents)}`}</span></span>
        <label className="check-row small">
          <input type="checkbox" checked={!!paid} disabled={busy} onChange={(e) => onTick(e.target.checked)} /> {paying ? 'Paid' : 'Received'}
        </label>
      </div>
      <div className="small muted">{note.replace(/^.*?: /, '') || 'Winnings'}{changed && <span className="warn"> · ticked at {fmtMoney(Math.abs(paid!.amountCents))}, now {fmtMoney(Math.abs(p.cents))}: re-tick when settled</span>}</div>
      {paying && !paid && (
        <div className="row wrap">
          {venmo && <a className="btn btn-sm btn-primary" href={venmo} target="_blank" rel="noreferrer">Pay with Venmo</a>}
          {paypal && <a className="btn btn-sm" href={paypal} target="_blank" rel="noreferrer">PayPal</a>}
          {handles?.zelle && <span className="small">Zelle: <strong>{handles.zelle}</strong></span>}
          {!venmo && !paypal && !handles?.zelle && <span className="small muted">No Venmo, PayPal or Zelle on file.</span>}
          <button type="button" className="linkish small" onClick={onEdit}>{editing ? 'Close' : handles ? 'Edit details' : 'Add their details'}</button>
        </div>
      )}
      {editing && <div className="subcard"><PayHandlesForm playerId={p.playerId} initial={handles} onSaved={onSaved} compact /></div>}
    </li>
  );
}

/** Commissioners (Play page): season dues per golfer and who has paid. */
export function SeasonDues({ season, onChanged }: { season: Season; onChanged: () => void }) {
  const { league } = useLeague();
  const allowed = league.features.includes('payments');
  const paid = useAsync(() => api.duesPaid(season.id), [season.id], { fresh: true });
  const roster = useAsync(() => api.players(league.id), [league.id]);
  const players = roster.data ?? [];
  const [amount, setAmount] = useState(season.duesCents ? String(season.duesCents / 100) : '');
  const [editing, setEditing] = useState(!season.duesCents);
  const [showAll, setShowAll] = useState(false);
  const { busy, error, setError, run } = useAction();
  if (!allowed) return null;
  const golfers = players.filter((p) => p.active).sort((a, b) => Number(a.isSub) - Number(b.isSub) || a.displayName.localeCompare(b.displayName));
  const regulars = golfers.filter((p) => !p.isSub);
  const marks = paid.data ?? {};
  const inCount = regulars.filter((p) => marks[p.id]).length;
  const collected = Object.values(marks).reduce((s, m) => s + m.amountCents, 0);
  const shown = showAll ? golfers : regulars;

  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>Season dues</h2>
        {season.duesCents && !editing && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Change amount</button>}
      </div>
      {editing ? (
        <form className="row wrap" onSubmit={async (e) => {
          e.preventDefault();
          const n = amount.trim() ? Number(amount) : 0;
          if (!(n >= 0 && n <= 10000)) return setError('Enter dues in dollars, up to $10,000.');
          const ok = await run(async () => { await api.setSeasonDues(season.id, Math.round(n * 100) || null); return true; });
          if (ok) { setEditing(false); onChanged(); }
        }}>
          <label className="inline">Each golfer pays up front<span className="prefixed"><span>$</span><input inputMode="decimal" value={amount} placeholder="e.g. 150" onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, '')); setError(null); }} /></span></label>
          <button className="btn btn-sm" disabled={busy}>Save</button>
          <span className="small muted grow">For example the season's skins and closest-to-the-pin money. Leave blank for no dues.</span>
        </form>
      ) : season.duesCents ? (
        <>
          <p><strong>{fmtMoney(season.duesCents)}</strong> a golfer · <strong>{inCount} of {regulars.length}</strong> paid · {fmtMoney(collected)} collected</p>
          <div className="pick-list">
            {shown.map((p) => (
              <label key={p.id} className="check-row small">
                <input type="checkbox" checked={!!marks[p.id]} disabled={busy}
                  onChange={async (e) => { const on = e.target.checked; await run(() => api.markDuesPaid(season.id, p.id, on)); paid.reload(); }} />
                {p.displayName}{p.isSub && <span className="muted"> (sub)</span>}
              </label>
            ))}
          </div>
          {golfers.length > regulars.length && <div><button type="button" className="linkish small" onClick={() => setShowAll(!showAll)}>{showAll ? 'Hide subs' : 'Show subs too'}</button></div>}
          <p className="small muted">Golfers see their own dues on Home with a button to pay you (from Settings → How golfers pay you).</p>
        </>
      ) : null}
      <ErrorText>{error ?? paid.error}</ErrorText>
    </section>
  );
}

/** Golfers (Home): this season's dues, paid or with a button to pay the commissioner. */
export function MyDues({ season, players }: { season: Season; players: Player[] }) {
  const { league } = useLeague();
  const { user } = useAuth();
  const mine = players.find((p) => p.active && p.userId && p.userId === user?.id);
  const data = useAsync(async () => {
    if (!mine || !season.duesCents) return null;
    const [paid, handles] = await Promise.all([api.duesPaid(season.id), api.paymentHandles(league.id)]);
    return { paid: paid[mine.id] ?? null, handles };
  }, [season.id, mine?.id, season.duesCents], { fresh: true });
  if (!mine || !season.duesCents || !league.features.includes('payments') || !data.data) return null;
  const { paid, handles } = data.data;
  const note = `${league.name} ${season.name || season.year} dues`;
  const venmo = venmoPayUrl(handles?.venmo, season.duesCents, note);
  const paypal = paypalPayUrl(handles?.paypalMe, season.duesCents);
  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>{season.name || season.year} season dues</h2>
        {paid ? <span className="badge badge-ok">Paid ✓</span> : <span className="badge badge-neutral">Not paid yet</span>}
      </div>
      <p><strong>{fmtMoney(season.duesCents)}</strong> to the commissioner, for the season's skins and closest-to-the-pin money.</p>
      {!paid && (venmo || paypal || handles?.zelle) && (
        <div className="row wrap">
          {venmo && <a className="btn btn-primary btn-sm" href={venmo} target="_blank" rel="noreferrer">Pay with Venmo</a>}
          {paypal && <a className="btn btn-sm" href={paypal} target="_blank" rel="noreferrer">PayPal</a>}
          {handles?.zelle && <span className="small">Zelle: <strong>{handles.zelle}</strong></span>}
        </div>
      )}
      {!paid && <p className="small muted">The commissioner ticks you off once it arrives.</p>}
    </section>
  );
}
