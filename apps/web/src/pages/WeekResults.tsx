import { useMemo, useState } from 'react';
import { ErrorText } from '../components/ui';
import { api } from '../lib/backend';
import { useAction, useAsync, useLeague } from '../lib/hooks';
import { buildWeekRecap } from '../lib/recap';
import { ShareWeek } from './ShareWeek';
import { STORY_MAX_CHARS } from '../../../../supabase/functions/send-recap/story';
import type { IndividualRules, PlacedLine } from '@golfscorehq/engine';
import { fmtMoney, individualRules, playsForMoney } from '../lib/scoring';
import { fmtToPar } from '../lib/standings';
import { settleWeek, totalsFromLedger, type PlayerTotals } from '../lib/settlement';
import { isCommissioner, type Layout, type LeagueEvent, type RoundData, type Season } from '../lib/types';

const signed = (c: number) => (c > 0 ? `+${fmtMoney(c)}` : c < 0 ? `−${fmtMoney(-c)}` : '$0');

/** Settlement controls for the commissioner, and the week's results for everyone. */
export function WeekResults({ event, season, layout, rounds, names, onChanged }: {
  event: LeagueEvent; season: Season; layout: Layout & { courseName?: string | null }; rounds: RoundData[]; names: Map<string, string>; onChanged: () => void;
}) {
  const { league } = useLeague();
  const commish = isCommissioner(league.role);
  const settled = event.status === 'settled';
  const extra = useAsync(async () => {
    const [ledger, decisions] = await Promise.all([api.ledger(event.id), api.ctpDecisions(event.id)]);
    return { ledger, decisions };
  }, [event.id, event.status]);
  const { busy, error, run } = useAction();
  const decisions = extra.data?.decisions ?? {};
  const preview = useMemo(() => settleWeek(rounds, layout, season.rules, decisions), [rounds, layout, season.rules, decisions]);
  const rules = season.rules;
  const ind = individualRules(rules);
  const hasMoney = playsForMoney(rules);
  const shareable = rules.format !== 'scramble';
  const name = (id: string | null) => (id ? names.get(id) ?? '?' : '—');

  if (event.status === 'rainout') {
    return (
      <section className="card stack">
        <h2>Rainout</h2>
        <p className="muted">No scores this week.</p>
        {commish && <div><button className="btn btn-sm" disabled={busy} onClick={async () => { await run(() => api.updateEvent(event.id, { status: 'scheduled' })); onChanged(); }}>Undo rainout</button></div>}
        <ErrorText>{error}</ErrorText>
      </section>
    );
  }

  // After settling, everyone sees what was posted.
  if (settled) {
    const ledger = extra.data?.ledger ?? [];
    const totals = totalsFromLedger(ledger);
    const skins = ledger.filter((e) => e.kind === 'skin').sort((a, b) => (a.holeNumber ?? 0) - (b.holeNumber ?? 0));
    const ctp = ledger.filter((e) => e.kind === 'ctp').sort((a, b) => (a.holeNumber ?? 0) - (b.holeNumber ?? 0));
    return (
      <section className="card stack">
        <div className="row between wrap">
          <div className="row"><h2>Results</h2><span className="final-stamp num">Final</span></div>
          {commish && (
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm('Reopen this week? Its results are removed until you settle it again, and groups can edit their scores.')) return;
                await run(() => api.reopenEvent(event.id));
                onChanged();
              }}
            >
              Reopen week
            </button>
          )}
        </div>
        {!hasMoney && <p className="muted">Scores are final for this week.</p>}
        {ind && <Leaderboard rules={ind} lines={preview.leaderboard} name={name} placeMoney={Object.fromEntries(ledger.filter((e) => e.kind === 'place').map((e) => [e.playerId, e.amountCents]))} />}
        {rules.skins.enabled && (
          <div>
            <h3>Skins</h3>
            {skins.length ? skins.map((s, i) => <div key={i} className="row between small"><span>Hole {s.holeNumber} — {name(s.playerId)}</span><span className="good">{fmtMoney(s.amountCents)}</span></div>) : <p className="small muted">No skins — every hole was tied.</p>}
          </div>
        )}
        {rules.ctp.enabled && (
          <div>
            <h3>Closest to the pin</h3>
            {ctp.length ? ctp.map((s, i) => <div key={i} className="row between small"><span>Hole {s.holeNumber} — {name(s.playerId)}</span><span className="good">{fmtMoney(s.amountCents)}</span></div>) : <p className="small muted">Nobody claimed a CTP.</p>}
          </div>
        )}
        {totals.length > 0 && <MoneyTable totals={totals} name={name} individual={!!ind} />}
        <ErrorText>{error}</ErrorText>
        {shareable && <ShareWeek event={event} season={season} layout={layout} rounds={rounds} names={names} />}
        {league.features.includes('weekly_recap') && shareable && (
          <WeekRecap event={event} season={season} layout={layout} rounds={rounds} names={names} />
        )}
      </section>
    );
  }

  if (!commish) return null;

  const disputes = preview.ctp.filter((c) => c.disputed || c.decided);
  return (
    <section className="card stack settle">
      <h2>Settle the week</h2>
      {rounds.length === 0 ? (
        <p className="muted">No groups have scored yet. If the week was rained out, mark it here.</p>
      ) : (
        <>
          {preview.unsubmitted > 0 && (
            <p className="warn small">{preview.unsubmitted} group{preview.unsubmitted === 1 ? " hasn't" : "s haven't"} submitted yet. Their scores so far are included if you settle now.</p>
          )}
          {disputes.map((c) => (
            <label key={c.holeNumber} className={c.disputed ? 'dispute' : ''}>
              Hole {c.holeNumber} CTP: {c.disputed ? 'two groups claimed the same marker. Who won?' : 'your decision'}
              <select
                value={decisions[c.holeNumber] ?? ''}
                disabled={busy}
                onChange={async (e) => { await run(() => api.setCtpDecision(league.id, event.id, c.holeNumber, e.target.value || null)); extra.reload(); }}
              >
                <option value="">Undecided (no payout)</option>
                {c.contenders.map((p) => <option key={p} value={p}>{name(p)}</option>)}
              </select>
            </label>
          ))}
          {ind && <Leaderboard rules={ind} lines={preview.leaderboard} name={name} placeMoney={Object.fromEntries(preview.entries.filter((e) => e.kind === 'place').map((e) => [e.playerId, e.amountCents]))} />}
          {hasMoney ? (
            <>
              {rules.skins.enabled && (
                <p className="small">
                  <strong>Skins:</strong>{' '}
                  {preview.skins.length ? preview.skins.map((s) => `hole ${s.holeNumber} ${name(s.playerId).split(' ')[0]} (${fmtMoney(s.value)})`).join(', ') : 'none — every hole tied'}
                  {preview.skinsUnawarded > 0 && preview.skins.length > 0 ? ` · ${fmtMoney(preview.skinsUnawarded)} carried off the last hole` : ''}
                </p>
              )}
              {rules.ctp.enabled && (
                <p className="small">
                  <strong>CTP:</strong>{' '}
                  {preview.ctp.map((c) => `hole ${c.holeNumber} ${c.disputed ? 'disputed' : c.winner ? name(c.winner).split(' ')[0] : 'nobody'}`).join(', ')}
                </p>
              )}
              <MoneyTable totals={preview.totals} name={name} individual={!!ind} />
            </>
          ) : (
            <p className="small muted">This league doesn't play for money, so settling just makes the scores final.</p>
          )}
          <p className="small muted">Settling posts these results for everyone and locks scoring. You can reopen the week to fix a score.</p>
        </>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="row wrap">
        {rounds.length > 0 && (
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              const ok = await run(async () => { await api.settleEvent(event.id, preview.entries); return true; });
              if (ok) onChanged();
            }}
          >
            {busy ? 'Settling…' : 'Settle and post results'}
          </button>
        )}
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={async () => {
            if (rounds.length && !window.confirm('Mark this week as a rainout? Scores entered so far are kept but not counted.')) return;
            await run(() => api.updateEvent(event.id, { status: 'rainout' }));
            onChanged();
          }}
        >
          Mark as rainout
        </button>
      </div>
    </section>
  );
}

/** Pro: the week's recap. Everyone can copy it; commissioners can email it to the league. */
function WeekRecap({ event, season, layout, rounds, names }: {
  event: LeagueEvent; season: Season; layout: Layout; rounds: RoundData[]; names: Map<string, string>;
}) {
  const { league } = useLeague();
  const commish = isCommissioner(league.role);
  const [copied, setCopied] = useState(false);
  const [sentMsg, setSentMsg] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  const text = useAsync(async () => {
    const [events, seasonLedger] = await Promise.all([api.events(season.id), api.seasonLedger(season.id)]);
    const upTo = new Set(events.filter((e) => e.status === 'settled' && e.weekNumber <= event.weekNumber).map((e) => e.id));
    return buildWeekRecap({
      leagueName: league.name, event, season, layout, rounds,
      players: [...names].map(([id, displayName]) => ({ id, displayName })),
      weekLedger: seasonLedger.filter((e) => e.eventId === event.id),
      seasonLedger: seasonLedger.filter((e) => upTo.has(e.eventId)),
    }).text;
  }, [event.id, event.status, rounds]);
  // The AI write-up: drafted on request, edited freely, and sent as the commissioner leaves it.
  const [story, setStory] = useState('');
  // What the preview shows; updated when a draft arrives or the commissioner finishes editing.
  const [previewStory, setPreviewStory] = useState('');
  const drafting = useAction();
  const preview = useAsync(async () => (commish ? api.recapPreview(event.id, previewStory || null) : null), [event.id, commish, sentMsg, previewStory]);

  async function draft() {
    if (story.trim() && !window.confirm('Replace your write-up with a new draft?')) return;
    const s = await drafting.run(() => api.draftRecapStory(event.id));
    if (s) { setStory(s); setPreviewStory(s); }
  }

  async function copy() {
    if (!text.data) return;
    try {
      await navigator.clipboard.writeText(text.data);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy the recap:', text.data);
    }
  }

  async function send(force: boolean) {
    const p = preview.data;
    if (!p) return;
    const ask = force
      ? `This week was already emailed. Send it again to ${p.recipients} golfer${p.recipients === 1 ? '' : 's'}?`
      : `Email the week ${event.weekNumber} recap to ${p.recipients} golfer${p.recipients === 1 ? '' : 's'}?`;
    if (!window.confirm(ask)) return;
    const res = await run(() => api.sendRecap(event.id, { force, story: story.trim() || null }));
    if (res) setSentMsg(`Sent to ${res.sent} golfer${res.sent === 1 ? '' : 's'}${api.mode === 'demo' ? ' (demo: no real emails go out)' : ''}.`);
  }

  const p = preview.data;
  return (
    <div className="stack recap">
      <div className="row between wrap">
        <h3>Weekly recap</h3>
        <button className="btn btn-sm" disabled={!text.data} onClick={copy}>{copied ? 'Copied ✓' : 'Copy recap'}</button>
      </div>
      {text.data && <pre className="recap-text">{text.data}</pre>}
      <ErrorText>{text.error}</ErrorText>
      {commish && (
        <div className="stack">
          {preview.error ? (
            <ErrorText>{preview.error}</ErrorText>
          ) : p ? (
            <>
              <p className="small">
                {p.recipients} golfer{p.recipients === 1 ? '' : 's'} will get an email with their own winnings and how to pay.
                {p.alreadySent && <> Already sent {new Date(p.alreadySent.sent_at).toLocaleString()} to {p.alreadySent.recipients}.</>}
              </p>
              {p.missing.length > 0 && (
                <p className="small warn">No email on file for {p.missing.join(', ')}. Add them on the Roster page.</p>
              )}
              <div className="subcard stack">
                <div className="row between wrap">
                  <strong>Write-up</strong>
                  <button className="btn btn-sm" disabled={drafting.busy || busy} onClick={draft}>
                    {drafting.busy ? 'Writing…' : story.trim() ? 'Write a new one' : 'Write it up with AI'}
                  </button>
                </div>
                <p className="small muted">
                  A short, fun opening for the top of the email, written from this week's results. Read it over and change anything you like; it's sent exactly as it appears here. Leave it empty to send just the results.
                  {api.mode === 'demo' && ' (Demo: a fill-in-the-blanks sample. The live site writes it with AI.)'}
                </p>
                <textarea
                  rows={6}
                  maxLength={STORY_MAX_CHARS}
                  value={story}
                  placeholder="Tap “Write it up with AI”, or type your own."
                  onChange={(e) => setStory(e.target.value)}
                  onBlur={() => setPreviewStory(story.trim())}
                />
                <ErrorText>{drafting.error}</ErrorText>
              </div>
              {sentMsg && <p className="small good">{sentMsg}</p>}
              <div className="row wrap">
                <button className="btn btn-primary btn-sm" disabled={busy || p.recipients === 0} onClick={() => send(!!p.alreadySent)}>
                  {busy ? 'Sending…' : p.alreadySent ? 'Send again' : 'Email the recap'}
                </button>
              </div>
              <details className="small">
                <summary>Preview the email</summary>
                <p><strong>{p.subject}</strong></p>
                <pre className="recap-text">{p.text}</pre>
              </details>
            </>
          ) : (
            <p className="small muted">Checking who gets the email…</p>
          )}
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </div>
  );
}

/** Stroke play or Stableford finishing order. Unfinished rounds are listed without a place. */
function Leaderboard({ rules, lines, name, placeMoney }: { rules: IndividualRules; lines: PlacedLine[]; name: (id: string) => string; placeMoney: Record<string, number> }) {
  if (!lines.length) return null;
  const net = !!rules.handicaps?.enabled;
  return (
    <div>
      <h3>{rules.format === 'stableford' ? 'Stableford' : 'Stroke play'}{net ? ' (net)' : ''}</h3>
      <div className="scroll-x">
        <table className="money">
          <thead><tr><th>Pos</th><th>Golfer</th><th>Gross</th>{net && rules.format === 'strokePlay' && <th>Net</th>}{rules.format === 'stableford' && <th>Points</th>}{Object.keys(placeMoney).length > 0 && <th>Won</th>}</tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.roundId}-${l.playerId}`}>
                <td>{l.place === null ? '—' : `${l.tied ? 'T' : ''}${l.place}`}</td>
                <td className="name">{name(l.playerId)}</td>
                <td>{l.complete ? l.gross : `thru ${l.thru}`}</td>
                {net && rules.format === 'strokePlay' && <td><strong>{fmtToPar(l.toPar)}</strong></td>}
                {rules.format === 'stableford' && <td><strong>{l.points}</strong></td>}
                {Object.keys(placeMoney).length > 0 && <td className="good">{placeMoney[l.playerId] ? fmtMoney(placeMoney[l.playerId]!) : ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lines.some((l) => !l.complete) && <p className="small muted">Only finished rounds get a place.</p>}
    </div>
  );
}

function MoneyTable({ totals, name, individual }: { totals: PlayerTotals[]; name: (id: string) => string; individual: boolean }) {
  return (
    <div className="scroll-x">
      <table className="money">
        <thead><tr><th>Golfer</th>{individual ? <th>Place</th> : <><th>Match</th><th>Press</th></>}<th>Skins</th><th>CTP</th><th>Total</th></tr></thead>
        <tbody>
          {totals.map((t) => (
            <tr key={t.playerId}>
              <td className="name">{name(t.playerId)}</td>
              {individual ? <td>{t.place ? signed(t.place) : ''}</td> : <>
                <td>{t.match ? signed(t.match) : ''}</td>
                <td>{t.press ? signed(t.press) : ''}</td>
              </>}
              <td>{t.skin ? signed(t.skin) : ''}</td>
              <td>{t.ctp ? signed(t.ctp) : ''}</td>
              <td className={t.total > 0 ? 'good' : t.total < 0 ? 'warn' : ''}><strong>{signed(t.total)}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
