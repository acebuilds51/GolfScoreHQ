import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/backend';
import { useAction, useAsync, useLeague } from '../lib/hooks';
import { COMMISH_TEASERS, GOLFER_TEASERS, nextTeaser, PRICE, PRO_CENTS, PRO_PERKS, shareDollars, type ProTeaser } from '../lib/plans';
import { fmtMoney } from '../lib/scoring';
import { isCommissioner } from '../lib/types';
import { ErrorText } from './ui';

const SNOOZE_DAYS = 14;
const snoozeKey = (leagueId: string, who: string) => `gshq-upgrade-snooze:${leagueId}:${who}`;
function snoozed(key: string): boolean {
  try { return Number(localStorage.getItem(key) ?? 0) > Date.now(); } catch { return false; }
}
function snooze(key: string) {
  try { localStorage.setItem(key, String(Date.now() + SNOOZE_DAYS * 24 * 3600 * 1000)); } catch { /* ignore */ }
}

/** "Joe, Mike and 4 others" */
export function namesLine(names: string[]): string {
  const first = names.map((n) => n.split(' ')[0]!);
  if (first.length <= 3) return first.length === 3 ? `${first[0]}, ${first[1]} and ${first[2]}` : first.join(' and ');
  return `${first[0]}, ${first[1]} and ${first.length - 2} others`;
}

/**
 * "Wouldn't it be great if…? You get that with Pro!" A different one each time
 * the card appears (and on "Another idea"), with the full list of what Pro includes folded away.
 */
function Teaser({ list, who }: { list: ProTeaser[]; who: string }) {
  const [i, setI] = useState(() => nextTeaser(list, `gshq-upgrade-teaser:${who}`));
  const t = list[i]!;
  return (
    <div className="teaser stack">
      <div className="row teaser-wish"><span className="teaser-icon" aria-hidden="true">{t.icon}</span><strong>{t.wish}</strong></div>
      <p>{t.answer} <strong className="teaser-pro">You get that with Pro!</strong></p>
      <div className="row wrap small">
        <button type="button" className="linkish" onClick={() => setI(nextTeaser(list, `gshq-upgrade-teaser:${who}`))}>Another idea ›</button>
        <details className="teaser-all">
          <summary>Everything in Pro</summary>
          <ul className="ticks small">{PRO_PERKS.map((p) => <li key={p}>{p}</li>)}</ul>
        </details>
      </div>
    </div>
  );
}

/**
 * Free leagues, on Home: a taste of what Pro adds, then what it costs each
 * golfer for the season. Golfers can say they'd chip in their share (the
 * commissioner gets a notification); commissioners see who has. "Not now"
 * hides it for two weeks.
 * `golfers`: the league's regular golfers, to split the price across.
 */
export function UpgradeCard({ golfers }: { golfers: number }) {
  const { league } = useLeague();
  const commish = isCommissioner(league.role);
  const key = snoozeKey(league.id, commish ? 'commish' : 'golfer');
  const [hidden, setHidden] = useState(() => snoozed(key));
  const interest = useAsync(() => api.upgradeInterest(league.id), [league.id]);
  const { busy, error, run } = useAction();
  if (league.effectivePlan !== 'free' || hidden) return null;

  const share = shareDollars(golfers);
  const i = interest.data;
  const notNow = <button className="btn btn-ghost btn-sm" onClick={() => { snooze(key); setHidden(true); }}>Not now</button>;
  const costLine = share
    ? <>All of Pro is <strong>{PRICE.pro} a year for the whole league</strong>. Split across your {golfers} golfers, that's about <strong className="num upgrade-share">${share}</strong> each for the season.</>
    : <>All of Pro is <strong>{PRICE.pro} a year for the whole league</strong>.</>;

  if (commish) {
    return (
      <section className="card stack upgrade-card">
        <div className="row between wrap"><h2>Unlock Pro for {league.name}</h2><span className="badge badge-pro">Pro</span></div>
        <Teaser list={COMMISH_TEASERS} who="commish" />
        <p>{costLine}</p>
        {i && i.count > 0 && (
          <p className="notice">
            <strong>{namesLine(i.names)}</strong> {i.count === 1 ? 'says they' : 'say they'}'d chip in: {fmtMoney(i.totalCents)} of {PRICE.pro} so far.
          </p>
        )}
        {i && i.count === 0 && share && <p className="small muted">Golfers see this too, and can tell you they'd chip in their ${share}.</p>}
        <div className="row wrap">
          <Link className="btn btn-primary" to="settings#plan">See Pro</Link>
          {notNow}
        </div>
      </section>
    );
  }

  // Golfers: ask if they'd chip in their share.
  return (
    <section className="card stack upgrade-card">
      <div className="row between wrap"><h2>Get more out of league night</h2><span className="badge badge-pro">Pro</span></div>
      <Teaser list={GOLFER_TEASERS} who="golfer" />
      <p>{costLine}</p>
      {i?.mine ? (
        <>
          <p className="notice">You told your commissioner you'd chip in {fmtMoney(i.mine)}.{i.count > 1 ? ` ${i.count} golfers have so far (${fmtMoney(i.totalCents)} of ${PRICE.pro}).` : ''}</p>
          <div className="row wrap">
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => { await run(() => api.takeBackChipIn(league.id)); interest.reload(); }}>Changed my mind</button>
            {notNow}
          </div>
        </>
      ) : share ? (
        <>
          <p><strong>Would you chip in ${share} for the season?</strong> We'll let your commissioner know.{i && i.count > 0 ? ` ${i.count} golfer${i.count === 1 ? ' has' : 's have'} already.` : ''}</p>
          <div className="row wrap">
            <button className="btn btn-primary" disabled={busy} onClick={async () => { await run(() => api.chipIn(league.id, Math.min(share * 100, PRO_CENTS))); interest.reload(); }}>
              {busy ? 'Sending…' : `Yes, I'd chip in $${share}`}
            </button>
            {notNow}
          </div>
        </>
      ) : <div className="row wrap">{notNow}</div>}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
