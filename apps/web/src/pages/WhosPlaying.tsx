import { useState } from 'react';
import { ErrorText, ProLock } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync, useAuth, useLeague } from '../lib/hooks';
import { isCommissioner, type Player, type RsvpStatus, type SubRequest } from '../lib/types';

const LABEL: Record<RsvpStatus, string> = { in: "I'm in", out: "I'm out", maybe: 'Maybe' };
const SHORT: Record<RsvpStatus, string> = { in: 'In', out: 'Out', maybe: 'Maybe' };

/** In / Out / Maybe buttons for one golfer. */
export function RsvpButtons({ value, busy, onPick, short = false }: { value: RsvpStatus | undefined; busy: boolean; onPick: (s: RsvpStatus) => void; short?: boolean }) {
  return (
    <div className="rsvp-buttons" role="group" aria-label="Are you playing?">
      {(['in', 'maybe', 'out'] as RsvpStatus[]).map((s) => (
        <button key={s} type="button" className={`pill rsvp-${s} ${value === s ? 'on' : ''}`} aria-pressed={value === s} disabled={busy} onClick={() => onPick(s)}>
          {short ? SHORT[s] : LABEL[s]}
        </button>
      ))}
    </div>
  );
}

/** RSVP and sub finder for an open week. */
export function WhosPlaying({ eventId, weekNumber, players }: { eventId: string; weekNumber: number; players: Player[] }) {
  const { league } = useLeague();
  const { user } = useAuth();
  const commish = isCommissioner(league.role);
  const allowed = league.features.includes('rsvp');
  const data = useAsync(async () => {
    if (!allowed) return { rsvps: {} as Record<string, RsvpStatus>, requests: [] as SubRequest[] };
    const [rsvps, requests] = await Promise.all([api.rsvps(eventId), api.subRequests(eventId)]);
    return { rsvps, requests };
  }, [eventId, allowed]);
  const { busy, error, run } = useAction();
  const [showAll, setShowAll] = useState(false);

  if (!allowed) {
    return (
      <section className="card stack">
        <div className="row between"><h2>Who's playing</h2><ProLock /></div>
        <p className="small muted">Pro leagues get "Are you playing?" replies from every golfer and a sub finder: ask your subs, and the first to accept gets the spot.</p>
      </section>
    );
  }

  const rsvps = data.data?.rsvps ?? {};
  const active = players.filter((p) => p.active);
  const mine = active.find((p) => p.userId && p.userId === user?.id);
  const set = async (playerId: string, s: RsvpStatus) => { await run(() => api.setRsvp(league.id, eventId, playerId, s)); data.reload(); };
  const group = (s: RsvpStatus) => active.filter((p) => rsvps[p.id] === s);
  const noReply = active.filter((p) => !p.isSub && !rsvps[p.id]);
  const names = (list: Player[]) => list.map((p) => p.displayName).join(', ');
  const myOffers = (data.data?.requests ?? []).flatMap((r) => r.offers.filter((o) => mine && o.playerId === mine.id && o.status === 'offered').map(() => r));

  return (
    <>
      {myOffers.map((r) => (
        <section key={r.id} className="card stack offer">
          <h2>You're asked to sub in week {weekNumber}</h2>
          <p className="small">{r.teeSlot ? `Tee time ${r.teeSlot}. ` : ''}{r.spots - r.filled} spot{r.spots - r.filled === 1 ? '' : 's'} open. First to say yes gets it.</p>
          <div className="row">
            <button className="btn btn-primary" disabled={busy} onClick={async () => {
              const result = await run(() => api.respondSubOffer(r.id, mine!.id, true));
              data.reload();
              if (result === 'too_late') window.alert('Sorry, someone else already took that spot.');
            }}>I'll play</button>
            <button className="btn" disabled={busy} onClick={async () => { await run(() => api.respondSubOffer(r.id, mine!.id, false)); data.reload(); }}>Can't make it</button>
          </div>
        </section>
      ))}

      <section className="card stack">
        <div className="row between wrap">
          <h2>Who's playing</h2>
          <span className="small muted">{group('in').length} in · {group('maybe').length} maybe · {group('out').length} out · {noReply.length} no reply</span>
        </div>
        {mine ? (
          <div className="row wrap">
            <span className="small">Week {weekNumber}, are you playing?</span>
            <RsvpButtons value={rsvps[mine.id]} busy={busy} onPick={(s) => set(mine.id, s)} />
          </div>
        ) : (
          !commish && <p className="small muted">Ask your commissioner for your invite link so you can reply for yourself.</p>
        )}
        <div className="small stack" style={{ gap: 4 }}>
          {group('in').length > 0 && <p><strong>In:</strong> {names(group('in'))}</p>}
          {group('maybe').length > 0 && <p><strong>Maybe:</strong> {names(group('maybe'))}</p>}
          {group('out').length > 0 && <p><strong>Out:</strong> {names(group('out'))}</p>}
          {noReply.length > 0 && <p className="muted"><strong>No reply:</strong> {names(noReply)}</p>}
        </div>
        {commish && (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAll(!showAll)}>{showAll ? 'Done' : 'Set replies for golfers'}</button>
            {showAll && (
              <ul className="list">
                {active.map((p) => (
                  <li key={p.id} className="list-row">
                    <span className="grow">{p.displayName}{p.isSub && <span className="badge badge-neutral">Sub</span>}</span>
                    <RsvpButtons short value={rsvps[p.id]} busy={busy} onPick={(s) => set(p.id, s)} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <ErrorText>{error}</ErrorText>
      </section>

      {commish && <SubFinder eventId={eventId} players={active} rsvps={rsvps} requests={data.data?.requests ?? []} onChanged={data.reload} />}
    </>
  );
}

const OFFER_LABEL = { offered: 'Asked', accepted: 'Playing', declined: "Can't", too_late: 'Too late' } as const;

function SubFinder({ eventId, players, rsvps, requests, onChanged }: { eventId: string; players: Player[]; rsvps: Record<string, RsvpStatus>; requests: SubRequest[]; onChanged: () => void }) {
  const { league } = useLeague();
  const [open, setOpen] = useState(false);
  const [spots, setSpots] = useState('1');
  const [teeSlot, setTeeSlot] = useState('');
  // Ask subs first, plus anyone who hasn't said they're in or out.
  const candidates = players.filter((p) => rsvps[p.id] !== 'in' && rsvps[p.id] !== 'out').sort((a, b) => Number(b.isSub) - Number(a.isSub) || a.displayName.localeCompare(b.displayName));
  const [ask, setAsk] = useState<Set<string>>(new Set());
  const { busy, error, setError, run } = useAction();
  const name = (id: string) => players.find((p) => p.id === id)?.displayName ?? '?';

  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>Subs</h2>
        {!open && <button className="btn btn-sm btn-primary" onClick={() => { setOpen(true); setAsk(new Set(candidates.filter((p) => p.isSub).map((p) => p.id))); }}>Find a sub</button>}
      </div>
      {requests.length === 0 && !open && <p className="small muted">Short a player? Ask your subs. Each one gets "I'll play / Can't make it", and the first yes gets the spot.</p>}
      {requests.map((r) => (
        <div key={r.id} className="subcard stack">
          <div className="row between wrap">
            <strong>{r.filled}/{r.spots} spot{r.spots === 1 ? '' : 's'} filled{r.teeSlot ? ` · tee time ${r.teeSlot}` : ''}</strong>
            {!r.closed ? (
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => { await run(() => api.closeSubRequest(r.id)); onChanged(); }}>Stop asking</button>
            ) : <span className="badge badge-ok">Closed</span>}
          </div>
          <div className="week-chips">
            {r.offers.map((o) => <span key={o.playerId} className={`chip offer-${o.status}`}>{name(o.playerId)} · {OFFER_LABEL[o.status]}</span>)}
          </div>
        </div>
      ))}
      {open && (
        <div className="subcard stack">
          <div className="grid four">
            <label>Spots<select value={spots} onChange={(e) => setSpots(e.target.value)}>{[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select></label>
            <label>Tee time (optional)<input inputMode="numeric" value={teeSlot} onChange={(e) => setTeeSlot(e.target.value.replace(/\D/g, ''))} /></label>
          </div>
          <p className="small muted">Who to ask:</p>
          <div className="row wrap">
            {candidates.map((p) => (
              <label key={p.id} className="check-row">
                <input type="checkbox" checked={ask.has(p.id)} onChange={(e) => { const s = new Set(ask); if (e.target.checked) s.add(p.id); else s.delete(p.id); setAsk(s); setError(null); }} />
                {p.displayName}{p.isSub ? ' (sub)' : ''}
              </label>
            ))}
            {candidates.length === 0 && <span className="small muted">Everyone has already said in or out.</span>}
          </div>
          <ErrorText>{error}</ErrorText>
          <div className="row">
            <button className="btn btn-primary" disabled={busy} onClick={async () => {
              if (!ask.size) return setError('Pick at least one golfer to ask.');
              const ok = await run(async () => { await api.createSubRequest(league.id, eventId, { spots: Number(spots), teeSlot: teeSlot ? Number(teeSlot) : null }, [...ask]); return true; });
              if (ok) { setOpen(false); onChanged(); }
            }}>Ask {ask.size || ''} golfer{ask.size === 1 ? '' : 's'}</button>
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          <p className="small muted">They'll see the request in the app. Email and text alerts come with the weekly recap emails.</p>
        </div>
      )}
      {!open && <ErrorText>{error}</ErrorText>}
    </section>
  );
}
