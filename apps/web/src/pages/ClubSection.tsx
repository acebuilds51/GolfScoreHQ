import { useEffect, useState } from 'react';
import { ErrorText } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync } from '../lib/hooks';
import { billingReturn, clearBillingReturn, fmtDay, PRICE } from '../lib/plans';
import type { LeagueSummary } from '../lib/types';

const MAX_LEAGUES = 5;

/** Your leagues: one Club plan covers up to 5 leagues you own. */
export function ClubSection({ leagues, onChanged }: { leagues: LeagueSummary[]; onChanged: () => void }) {
  const clubs = useAsync(() => api.myClubs(), []);
  const [name, setName] = useState('');
  const [returned] = useState(billingReturn);
  const { busy, error, setError, run } = useAction();
  const owned = leagues.filter((l) => l.role === 'owner');

  // Back from Stripe: wait for the payment to mark the club paid.
  useEffect(() => {
    if (!returned) return;
    clearBillingReturn();
    if (returned !== 'done') return;
    let tries = 0;
    const t = setInterval(() => { tries++; clubs.reload(); if (tries >= 10) clearInterval(t); }, 2000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async (getUrl: () => Promise<string>) => {
    const url = await run(getUrl);
    if (url) window.location.assign(url);
  };
  const paid = (iso: string | null) => !!iso && new Date(iso) > new Date();

  if (!clubs.data) return null;
  // Only show the Club pitch to people who own leagues (golfers don't need it).
  if (!clubs.data.length && owned.length === 0) return null;

  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>Club plan</h2>
        <span className="small muted"><span className="num upgrade-price">{PRICE.club}</span> a year for up to {MAX_LEAGUES} leagues</span>
      </div>

      {clubs.data.length === 0 ? (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (name.trim().length < 2) return setError('Give your club a name, like your course or organization.');
            const id = await run(() => api.createClub(name.trim()));
            if (id) await go(() => api.startCheckout({ clubId: id }));
          }}
        >
          <p className="small muted">Run more than one league? One Club plan gives every league you add all of Pro, for less than two Pro plans.</p>
          <label>
            Club name
            <input placeholder="Crystal Lake Golf Club" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} />
          </label>
          <div><button className="btn btn-primary" disabled={busy}>{busy ? 'Opening checkout…' : `Start a Club, ${PRICE.club}/year`}</button></div>
        </form>
      ) : (
        clubs.data.map((c) => {
          const isPaid = paid(c.expiresAt);
          const full = c.leagues.length >= MAX_LEAGUES;
          return (
            <div key={c.id} className="stack">
              <div className="row between wrap">
                <strong>{c.name}</strong>
                {isPaid ? <span className="small muted">Paid through {fmtDay(c.expiresAt!)}</span> : <span className="small warn">Not paid yet</span>}
              </div>
              {!isPaid ? (
                <div><button className="btn btn-primary" disabled={busy} onClick={() => go(() => api.startCheckout({ clubId: c.id }))}>{busy ? 'Opening checkout…' : `Pay for the Club, ${PRICE.club}/year`}</button></div>
              ) : (
                <>
                  <p className="small muted">Leagues in this club ({c.leagues.length} of {MAX_LEAGUES}). Only leagues you own can be added.</p>
                  <ul className="list">
                    {owned.map((l) => {
                      const inClub = c.leagues.some((x) => x.id === l.id);
                      const free = l.plan === 'pilot' || l.plan === 'comp';
                      return (
                        <li key={l.id} className="list-row">
                          <span className="grow">{l.name}{free && <span className="small muted"> · already free</span>}</span>
                          {inClub ? (
                            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => { const ok = await run(async () => { await api.setLeagueClub(l.id, null); return true; }); if (ok) { clubs.reload(); onChanged(); } }}>Remove</button>
                          ) : (
                            <button className="btn btn-sm" disabled={busy || full || free} onClick={async () => { const ok = await run(async () => { await api.setLeagueClub(l.id, c.id); return true; }); if (ok) { clubs.reload(); onChanged(); } }}>Add</button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <div><button className="btn" disabled={busy} onClick={() => go(() => api.billingPortal('/leagues'))}>Manage billing</button></div>
                </>
              )}
            </div>
          );
        })
      )}
      <ErrorText>{error ?? clubs.error}</ErrorText>
    </section>
  );
}
