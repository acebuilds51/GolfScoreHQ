import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorText, ProLock } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync, useAuth, useLeague, useLiveRefresh } from '../lib/hooks';
import { fmtDate } from '../lib/scoring';
import { savedGroupSize, smsBatches, telNumber } from '../lib/sms';
import { fmtTeeTime, GROUP_SIZE, matchRecipients, openSpotRecipients, partnerRecipients, sheetView, teeTimesFrom, type SheetView } from '../lib/teeSheet';
import { isCommissioner, type LeagueEvent, type LineupStatus, type Player, type Season, type TeeTime } from '../lib/types';

/**
 * The week's tee sheet: tee times and captains, groups filling up, who needs a
 * partner or a match, who's out, and one-tap texts to the right people.
 */
export function TeeSheetPanel({ event, players }: { event: LeagueEvent; players: Player[] }) {
  const { league } = useLeague();
  const { user } = useAuth();
  const commish = isCommissioner(league.role);
  const allowed = league.features.includes('lineup');
  const data = useAsync(async () => {
    if (!allowed) return null;
    const [sheet, rsvps, phones] = await Promise.all([
      api.teeSheet(event.id),
      league.features.includes('rsvp') ? api.rsvps(event.id) : Promise.resolve({}),
      commish || league.sharePhones ? api.phoneBook(league.id) : Promise.resolve({} as Record<string, string>),
    ]);
    return { sheet, rsvps, phones };
  }, [event.id, allowed, commish, league.sharePhones]);
  useLiveRefresh(league.id, data.reload, allowed);
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useAction();

  if (!allowed) {
    return (
      <section className="card stack">
        <div className="row between"><h2>Tee sheet</h2><ProLock /></div>
        <p className="small muted">Pro leagues post tee times and captains, golfers fill the groups themselves, and everyone sees who needs a partner or a match, with one tap to text them.</p>
      </section>
    );
  }
  if (!data.data) return data.error ? <ErrorText>{data.error}</ErrorText> : null;

  const { sheet, rsvps, phones } = data.data;
  const active = players.filter((p) => p.active);
  const name = (id: string) => players.find((p) => p.id === id)?.displayName ?? '?';
  const first = (id: string) => name(id).split(' ')[0];
  const me = active.find((p) => user && p.userId === user.id) ?? null;
  const view = sheetView(sheet, active, rsvps);
  const act = async (fn: () => Promise<void>) => { const ok = await run(async () => { await fn(); return true; }); if (ok) data.reload(); };
  // Captain (where the commissioner picked one) or anyone in the group can add golfers to it.
  const canManage = (slot: number) => !!me && (sheet.times.find((t) => t.slot === slot)?.captainId === me.id || view.slotOf.get(me.id) === slot);

  if (editing) {
    return <TeeTimesForm event={event} players={active} times={sheet.times} onSeason={sheet.seasonTimes > 0 && !sheet.custom}
      onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); data.reload(); }} />;
  }

  return (
    <section className="card stack tee-sheet">
      <div className="row between wrap">
        <h2>Tee sheet</h2>
        {commish && sheet.times.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Captains or times this week</button>}
      </div>
      {sheet.times.length === 0 && (commish ? (
        <div className="subcard stack">
          <p className="small">Set the season's tee times once on the <Link to={`/l/${league.slug}/play`}>Play page</Link> and every week gets them.</p>
          <div><button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Tee times for this week only</button></div>
        </div>
      ) : <p className="small muted">The commissioner hasn't posted tee times yet. You can still say if you need a partner or a match.</p>)}
      {commish && sheet.custom && sheet.seasonTimes > 0 && (
        <div className="row wrap">
          <span className="small muted">This week has its own tee times.</span>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => api.useSeasonTeeTimes(event.id))}>Use the season's tee times</button>
        </div>
      )}

      {me && <MyStatus event={event} me={me} view={view} players={active} phones={phones} busy={busy} act={act} />}

      {sheet.times.length > 0 && (
        <ol className="tee-groups">
          {view.groups.map((g) => {
            const mine = !!me && g.members.includes(me.id);
            const canAdd = (commish || canManage(g.slot)) && g.members.length < (commish ? GROUP_SIZE + 1 : GROUP_SIZE);
            const addable = active.filter((p) => !g.members.includes(p.id) && !view.out.includes(p.id));
            return (
              <li key={g.slot} className="tee-group">
                <div className="row between wrap">
                  <strong>T{g.slot}{g.time && <span className="muted"> · {fmtTeeTime(g.time)}</span>}</strong>
                  <span className={`small ${g.open ? '' : 'muted'}`}>{g.open ? `${g.open} open` : 'Full'}</span>
                </div>
                <div className="small">
                  {g.members.length === 0 ? <span className="muted">Open tee time.</span> : g.members.map((id, i) => (
                    <span key={id} className="tee-member">
                      {i > 0 && ', '}{name(id)}{id === g.captainId && <span className="muted"> (captain)</span>}
                      {(commish || canManage(g.slot)) && id !== me?.id && (
                        <button type="button" className="linkish" aria-label={`Take ${name(id)} out of T${g.slot}`} disabled={busy} onClick={() => act(() => api.lineupLeave(event.id, id))}>×</button>
                      )}
                    </span>
                  ))}
                </div>
                <div className="row wrap">
                  {me && !mine && g.open > 0 && <button className="btn btn-sm" disabled={busy} onClick={() => act(() => api.lineupJoin(event.id, me.id, g.slot))}>Join T{g.slot}</button>}
                  {mine && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => api.lineupLeave(event.id, me!.id))}>Leave</button>}
                  {canAdd && (
                    <select aria-label={`Add a golfer to T${g.slot}`} value="" disabled={busy} onChange={(e) => e.target.value && act(() => api.lineupJoin(event.id, e.target.value, g.slot))}>
                      <option value="">Add a golfer…</option>
                      {addable.map((p) => <option key={p.id} value={p.id}>{p.displayName}{p.isSub ? ' (sub)' : ''}{view.slotOf.has(p.id) ? ` (in T${view.slotOf.get(p.id)})` : ''}</option>)}
                    </select>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="small stack tee-lists">
        {view.needPartner.length > 0 && <p><strong>Need a partner:</strong> {view.needPartner.map(name).join(', ')}</p>}
        {view.teams.length > 0 && <p><strong>Need a match:</strong> {view.teams.map(([a, b]) => `${first(a)} & ${first(b)}`).join(' · ')}</p>}
        {view.playingNoGroup.length > 0 && <p><strong>Playing, no group yet:</strong> {view.playingNoGroup.map(name).join(', ')}</p>}
        {view.out.length > 0 && <p><strong>Not playing:</strong> {view.out.map(name).join(', ')}</p>}
        {view.noReply.length > 0 && <p className="muted"><strong>Haven't said:</strong> {view.noReply.map(name).join(', ')}</p>}
      </div>

      {commish && <CommissionerTools event={event} view={view} players={active} phones={phones} busy={busy} act={act} />}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

type Act = (fn: () => Promise<void>) => Promise<void>;

/** Group texts for a list of golfers, split under the carrier limit. */
function TextButtons({ ids, phones, message, label }: { ids: string[]; phones: Record<string, string>; message: string; label: string }) {
  const reachable = ids.filter((id) => telNumber(phones[id]));
  const batches = smsBatches(reachable.map((id) => phones[id]), message, savedGroupSize());
  if (!ids.length) return null;
  if (!batches.length) return <p className="small muted">Nobody to text has a phone number in the app yet.</p>;
  return (
    <div className="row wrap">
      {batches.length === 1
        ? <a className="btn btn-primary btn-sm" href={batches[0]!.link}>{label} ({batches[0]!.count})</a>
        : batches.map((b, i) => <a key={i} className="btn btn-primary btn-sm" href={b.link}>{label}: group {i + 1} of {batches.length} ({b.count})</a>)}
    </div>
  );
}

function weekWhen(event: LeagueEvent) {
  return `week ${event.weekNumber}${event.eventDate ? ` (${fmtDate(event.eventDate)})` : ''}`;
}

function MyStatus({ event, me, view, players, phones, busy, act }: {
  event: LeagueEvent; me: Player; view: SheetView; players: Player[]; phones: Record<string, string>; busy: boolean; act: Act;
}) {
  const { league } = useLeague();
  const [partner, setPartner] = useState('');
  const [picking, setPicking] = useState(false);
  const name = (id: string) => players.find((p) => p.id === id)?.displayName ?? '?';
  const first = (id: string) => name(id).split(' ')[0];
  const mySlot = view.slotOf.get(me.id);
  const myTeam = view.teams.find((t) => t.includes(me.id));
  const mate = myTeam ? myTeam.find((id) => id !== me.id)! : null;
  const looking = view.needPartner.includes(me.id);
  const out = view.out.includes(me.id);
  const link = `${window.location.origin}/l/${league.slug}/week/${event.id}`;
  const noPhones = Object.keys(phones).length === 0;
  const myGroup = mySlot ? view.groups.find((g) => g.slot === mySlot) : undefined;
  const at = myGroup?.time ? ` at ${fmtTeeTime(myGroup.time)}` : '';
  const hasRoom = !!myGroup && myGroup.open > 0;

  const status = myGroup ? `You're in T${myGroup.slot}${at}${hasRoom ? ` (${myGroup.open} open)` : ''}.`
    : mate ? `You and ${first(mate)} need a match.`
    : looking ? 'You need a partner.'
    : out ? "You're not playing this week."
    : 'Join a group below, or tell everyone what you need.';

  return (
    <div className="subcard stack">
      <strong>{status}</strong>
      <div className="row wrap">
        {!looking && !mySlot && <button className="btn btn-sm" disabled={busy} onClick={() => act(() => api.lineupStatus(event.id, me.id, 'partner'))}>I need a partner</button>}
        {!mate && !mySlot && <button className="btn btn-sm" disabled={busy} onClick={() => setPicking(!picking)}>My partner and I need a match</button>}
        {!out && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => api.lineupStatus(event.id, me.id, 'out'))}>Not playing</button>}
        {(looking || mate || out) && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => api.lineupStatus(event.id, me.id, 'none'))}>Clear</button>}
      </div>
      {picking && !mate && (
        <div className="row wrap">
          <select value={partner} onChange={(e) => setPartner(e.target.value)} aria-label="Your partner">
            <option value="">Your partner…</option>
            {players.filter((p) => p.id !== me.id && !view.out.includes(p.id)).map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}{p.isSub ? ' (sub)' : ''}{view.slotOf.has(p.id) ? ` (in T${view.slotOf.get(p.id)})` : ''}</option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" disabled={busy || !partner} onClick={async () => { await act(() => api.lineupStatus(event.id, me.id, 'match', partner)); setPicking(false); }}>Save</button>
        </div>
      )}
      {looking && (
        <TextButtons ids={partnerRecipients(view, players, me.id)} phones={phones} label="Text golfers who aren't paired up"
          message={`${first(me.id)} here: I need a partner for ${weekWhen(event)}. Anyone want to team up? ${link}`} />
      )}
      {mate && (
        <TextButtons ids={matchRecipients(view, me.id, mate)} phones={phones} label="Text open groups and golfers looking"
          message={`${first(me.id)} and ${first(mate)} here: we need a match for ${weekWhen(event)}. Got room in your group, or need a match too? ${link}`} />
      )}
      {hasRoom && myGroup && (
        <TextButtons ids={openSpotRecipients(view, me.id)} phones={phones} label="Text golfers looking for a group"
          message={`${first(me.id)} here: T${myGroup.slot}${at} has ${myGroup.open === 1 ? '1 spot' : `${myGroup.open} spots`} open for ${weekWhen(event)}. Want in? ${link}`} />
      )}
      {(looking || mate || hasRoom) && noPhones && <p className="small muted">To text from here, ask your commissioner to turn on phone-number sharing (Roster page).</p>}
    </div>
  );
}

/** Commissioner: set anyone's status, and nudge the golfers who haven't answered. */
function CommissionerTools({ event, view, players, phones, busy, act }: {
  event: LeagueEvent; view: SheetView; players: Player[]; phones: Record<string, string>; busy: boolean; act: Act;
}) {
  const { league } = useLeague();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState('');
  const [status, setStatus] = useState<LineupStatus>('partner');
  const [partner, setPartner] = useState('');
  const link = `${window.location.origin}/l/${league.slug}/week/${event.id}`;
  return (
    <div className="stack">
      {view.noReply.length > 0 && (
        <TextButtons ids={view.noReply} phones={phones} label="Text golfers who haven't said"
          message={`${league.name}, ${weekWhen(event)}: are you playing? Join a group or say you're out here: ${link}`} />
      )}
      {league.features.includes('rsvp') && event.eventDate && view.noReply.length > 0 && <ReminderNow event={event} />}
      <div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>{open ? 'Done' : "Set a golfer's status"}</button></div>
      {open && (
        <div className="row wrap">
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Golfer">
            <option value="">Golfer…</option>
            {players.map((p) => <option key={p.id} value={p.id}>{p.displayName}{p.isSub ? ' (sub)' : ''}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as LineupStatus)} aria-label="Status">
            <option value="partner">Needs a partner</option>
            <option value="match">Needs a match with…</option>
            <option value="out">Not playing</option>
            <option value="none">Clear</option>
          </select>
          {status === 'match' && (
            <select value={partner} onChange={(e) => setPartner(e.target.value)} aria-label="Partner">
              <option value="">Partner…</option>
              {players.filter((p) => p.id !== who).map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </select>
          )}
          <button className="btn btn-sm" disabled={busy || !who || (status === 'match' && !partner)}
            onClick={() => act(() => api.lineupStatus(event.id, who, status, status === 'match' ? partner : null))}>Save</button>
        </div>
      )}
    </div>
  );
}

/** Commissioner: email the "Are you playing?" reminder now, to golfers who haven't answered. */
function ReminderNow({ event }: { event: LeagueEvent }) {
  const { league } = useLeague();
  const preview = useAsync(() => api.reminderPreview(event.id), [event.id]);
  const [sent, setSent] = useState<number | null>(null);
  const { busy, error, run } = useAction();
  if (sent !== null) return <p className="small good">Reminder emailed to {sent} golfer{sent === 1 ? '' : 's'} ✓</p>;
  if (preview.error) return <p className="small muted">{preview.error}</p>;
  const p = preview.data;
  if (!p) return null;
  const when = league.rsvpReminderDays
    ? `Goes out on its own at 9 AM, ${league.rsvpReminderDays === 1 ? 'the day' : `${league.rsvpReminderDays} days`} before.`
    : 'Turn on automatic reminders in Settings.';
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row wrap">
        <button type="button" className="btn btn-sm" disabled={busy || p.recipients === 0}
          onClick={async () => { const r = await run(() => api.sendReminder(event.id)); if (r) setSent(r.sent); }}>
          {busy ? 'Sending…' : `Email "Are you playing?" now (${p.recipients})`}
        </button>
        <span className="small muted">{p.alreadySent ? `Sent ${fmtDate(p.alreadySent.sent_at.slice(0, 10))} to ${p.alreadySent.recipients}.` : when}</span>
      </div>
      {p.missing.length > 0 && <p className="small muted">No email on file: {p.missing.join(', ')}.</p>}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Commissioner: this week's captains (optional), and its tee times if they differ from the season's. */
function TeeTimesForm({ event, players, times, onSeason, onSaved, onCancel }: {
  event: LeagueEvent; players: Player[]; times: TeeTime[]; onSeason: boolean; onSaved: () => void; onCancel: () => void;
}) {
  const [changeTimes, setChangeTimes] = useState(times.length === 0);
  const [clock, setClock] = useState<string[]>(() => (times.length ? times.map((t) => t.time ?? '') : teeTimesFrom('17:10', 7, 9)));
  const [captains, setCaptains] = useState<Record<number, string>>(() => Object.fromEntries(times.map((t) => [t.slot, t.captainId ?? ''])));
  const { busy, error, setError, run } = useAction();
  const rows = changeTimes ? clock.map((time, i) => ({ slot: i + 1, time })) : times;
  const regulars = players.filter((p) => !p.isSub);
  const subs = players.filter((p) => p.isSub);

  return (
    <form className="card stack" onSubmit={async (e) => {
      e.preventDefault();
      const chosen = rows.map((r) => captains[r.slot]).filter(Boolean);
      if (new Set(chosen).size !== chosen.length) return setError('Each golfer can captain one tee time.');
      if (changeTimes && clock.some((t) => !t)) return setError('Every tee time needs a time.');
      const ok = await run(async () => {
        await api.setTeeTimes(event.id, rows.map((r) => ({ slot: r.slot, time: r.time || null, captainId: captains[r.slot] || null })));
        return true;
      });
      if (ok) onSaved();
    }}>
      <h2>Week {event.weekNumber} tee times</h2>
      {changeTimes ? (
        <>
          <p className="small muted">Different times for this week only. {onSeason ? 'Season changes will leave this week alone.' : ''}</p>
          <TimesEditor value={clock} onChange={setClock} />
        </>
      ) : (
        <p className="small muted">
          {onSeason ? "The season's tee times." : "This week's tee times."}{' '}
          <button type="button" className="linkish" onClick={() => setChangeTimes(true)}>Different times this week</button>
        </p>
      )}
      <div className="stack">
        <strong>Captains <span className="muted small">(optional)</span></strong>
        {rows.map((r) => (
          <label key={r.slot} className="row wrap tee-captain-row">
            <span className="tee-badge">{r.slot}</span>
            <span className="small" style={{ minWidth: 70 }}>{fmtTeeTime(r.time)}</span>
            <select value={captains[r.slot] ?? ''} onChange={(e) => { setCaptains({ ...captains, [r.slot]: e.target.value }); setError(null); }} aria-label={`Captain for tee time ${r.slot}`}>
              <option value="">No captain</option>
              {regulars.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
              {subs.length > 0 && <optgroup label="Subs">{subs.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</optgroup>}
            </select>
          </label>
        ))}
      </div>
      <p className="small muted">Only if your league uses captains: a captain is put in their own group and fills it. Without captains, golfers join a group themselves, and anyone in a group can add golfers to it.</p>
      <ErrorText>{error}</ErrorText>
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** First tee, minutes apart and how many, with each time editable for uneven gaps. */
function TimesEditor({ value, onChange }: { value: string[]; onChange: (times: string[]) => void }) {
  const [firstTee, setFirstTee] = useState(value[0] || '17:10');
  const [every, setEvery] = useState(String(value.length > 1 && value[0] && value[1] ? minutesBetween(value[0], value[1]) : 7));
  const [count, setCount] = useState(String(value.length || 9));
  const regen = (f: string, e: string, c: string) => onChange(teeTimesFrom(f || '17:10', Number(e) || 0, Math.min(30, Math.max(1, Number(c) || 1))));
  return (
    <div className="stack">
      <div className="grid three">
        <label>First tee<input type="time" value={firstTee} onChange={(e) => { setFirstTee(e.target.value); regen(e.target.value, every, count); }} /></label>
        <label>Minutes apart<input inputMode="numeric" value={every} onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setEvery(v); regen(firstTee, v, count); }} /></label>
        <label>Tee times<input inputMode="numeric" value={count} onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setCount(v); regen(firstTee, every, v); }} /></label>
      </div>
      <div className="tee-time-list">
        {value.map((t, i) => (
          <label key={i} className="tee-time-edit">
            <span className="tee-badge">{i + 1}</span>
            <input type="time" value={t} aria-label={`Tee time ${i + 1}`} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
          </label>
        ))}
      </div>
    </div>
  );
}

/** The season's tee times (Pro): set once during setup; every week gets them. */
export function SeasonTeeTimes({ season }: { season: Season }) {
  const { league } = useLeague();
  const commish = isCommissioner(league.role);
  const allowed = league.features.includes('lineup');
  const data = useAsync(async () => (allowed ? api.seasonTeeTimes(season.id) : []), [season.id, allowed]);
  const [clock, setClock] = useState<string[] | null>(null);
  const { busy, error, setError, run } = useAction();

  if (!allowed) {
    return commish ? (
      <section className="card stack">
        <div className="row between"><h2>Tee times</h2><ProLock /></div>
        <p className="small muted">Pro leagues set tee times once for the season. Every week gets them, golfers fill their own groups, and everyone sees who needs a partner or a match.</p>
      </section>
    ) : null;
  }
  if (!data.data) return null;
  const times = data.data;
  if (!times.length && !commish) return null;

  if (clock) {
    return (
      <form className="card stack" onSubmit={async (e) => {
        e.preventDefault();
        if (clock.some((t) => !t)) return setError('Every tee time needs a time.');
        const ok = await run(async () => { await api.setSeasonTeeTimes(season.id, clock); return true; });
        if (ok) { setClock(null); data.reload(); }
      }}>
        <h2>Tee times for the season</h2>
        <TimesEditor value={clock} onChange={(v) => { setClock(v); setError(null); }} />
        <p className="small muted">Every week gets these, including weeks you add later. Changing them updates the upcoming weeks; golfers stay with their tee time. A week can still have its own times (on the week's page).</p>
        <ErrorText>{error}</ErrorText>
        <div className="row">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save tee times'}</button>
          <button type="button" className="btn btn-ghost" onClick={() => setClock(null)}>Cancel</button>
        </div>
      </form>
    );
  }

  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>Tee times</h2>
        {commish && <button className="btn btn-ghost btn-sm" onClick={() => setClock(times.length ? [...times] : teeTimesFrom('17:10', 7, 9))}>{times.length ? 'Edit' : 'Set tee times'}</button>}
      </div>
      {times.length ? (
        <p className="small">{times.map((t, i) => `${i + 1}: ${fmtTeeTime(t)}`).join(' · ')}</p>
      ) : (
        <p className="small muted">Set them once and every week gets them. Golfers then join a group, or say they need a partner or a match.</p>
      )}
    </section>
  );
}

function minutesBetween(a: string, b: string) {
  const m = (t: string) => { const [h, mm] = t.split(':').map(Number) as [number, number]; return h * 60 + mm; };
  return Math.max(1, m(b) - m(a));
}