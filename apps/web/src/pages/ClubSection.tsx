import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorText } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync } from '../lib/hooks';
import { billingReturn, clearBillingReturn, fmtDay, PRICE } from '../lib/plans';
import { fmtDate } from '../lib/scoring';
import type { Club, LeagueEvent, LeagueSummary } from '../lib/types';

const MAX_LEAGUES = 5;

interface LeagueWeek {
  id: string; name: string; slug: string;
  next: LeagueEvent | null;
  /** RSVPs for the next week (Pro): in, out, and regulars who haven't said. */
  answers: { in: number; out: number; noReply: number } | null;
  last: LeagueEvent | null;
  error?: boolean;
}

/** This week across all the club's leagues: who's coming, and the latest results. */
function ClubWeek({ leagues }: { leagues: Club['leagues'] }) {
  const data = useAsync(() => Promise.all(leagues.map(async (l): Promise<LeagueWeek> => {
    try {
      const [seasons, players] = await Promise.all([api.seasons(l.id), api.players(l.id)]);
      const events = seasons[0] ? await api.events(seasons[0].id) : [];
      const next = events.find((e) => e.status === 'scheduled') ?? null;
      const last = [...events].reverse().find((e) => e.status === 'settled') ?? null;
      let answers: LeagueWeek['answers'] = null;
      if (next) {
        const r = await api.rsvps(next.id).catch(() => null);
        if (r) {
          const vals = Object.values(r);
          const regulars = players.filter((p) => p.active && !p.isSub);
          answers = { in: vals.filter((v) => v === 'in').length, out: vals.filter((v) => v === 'out').length, noReply: regulars.filter((p) => !r[p.id]).length };
        }
      }
      return { ...l, next, answers, last };
    } catch {
      return { ...l, next: null, answers: null, last: null, error: true };
    }
  })), [leagues.map((l) => l.id).join()]);

  if (!data.data) return <p className="small muted">Loading this week across your leagues…</p>;
  return (
    <div className="scroll-x">
      <table className="money club-week">
        <thead><tr><th>League</th><th>Next week</th><th>Playing</th><th>Latest results</th></tr></thead>
        <tbody>
          {data.data.map((w) => (
            <tr key={w.id}>
              <td className="name"><Link to={`/l/${w.slug}`}>{w.name}</Link></td>
              {w.error ? <td colSpan={3} className="muted">Couldn't load this league.</td> : (
                <>
                  <td>{w.next ? <Link to={`/l/${w.slug}/week/${w.next.id}`}>Week {w.next.weekNumber}{w.next.eventDate ? ` · ${fmtDate(w.next.eventDate)}` : ''}</Link> : <span className="muted">None scheduled</span>}</td>
                  <td>{w.answers ? <>{w.answers.in} in · {w.answers.out} out{w.answers.noReply ? <span className="muted"> · {w.answers.noReply} haven't said</span> : ''}</> : <span className="muted">—</span>}</td>
                  <td>{w.last ? <Link to={`/l/${w.slug}/standings`}>Week {w.last.weekNumber} final</Link> : <span className="muted">None yet</span>}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
                  {c.leagues.length > 0 && <ClubWeek leagues={c.leagues} />}
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
