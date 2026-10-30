import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorText, PLAN_LABEL } from '../components/ui';
import { namesLine } from '../components/UpgradeCard';
import { fmtMoney } from '../lib/scoring';
import { api } from '../lib/backend';
import { useAction, useAsync, useLeague } from '../lib/hooks';
import { billingReturn, clearBillingReturn, fmtDay, PRICE, PRO_PERKS } from '../lib/plans';

/** A pilot code (from the pilot invite) puts this free league on the pilot plan. */
function PilotCodeEntry() {
  const { league, reloadLeague } = useLeague();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const { busy, error, setError, run } = useAction();
  if (!open) return <p className="small muted">Invited to the 2027 pilot? <button type="button" className="linkish" onClick={() => setOpen(true)}>Enter your pilot code</button></p>;
  return (
    <form className="row wrap" onSubmit={async (e) => {
      e.preventDefault();
      if (!code.trim()) return setError('Enter the code from your invite, like PILOT-7F3A9C.');
      const ok = await run(async () => { await api.redeemPilotCode(code.trim(), league.id); return true; });
      if (ok) reloadLeague();
    }}>
      <input className="code-input" placeholder="PILOT-7F3A9C" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }} />
      <button className="btn btn-sm" disabled={busy}>{busy ? 'Checking…' : 'Use code'}</button>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

/** Settings: the league's plan, upgrading to Pro, and managing what's paid. */
export function PlanSection() {
  const { league, reloadLeague } = useLeague();
  const billing = useAsync(() => api.leagueBilling(league.id), [league.id, league.effectivePlan]);
  const { busy, error, run } = useAction();
  const [returned] = useState(billingReturn);
  const [waiting, setWaiting] = useState(returned === 'done' && league.effectivePlan === 'free');

  // Back from Stripe: the payment switches Pro on a few seconds later.
  useEffect(() => {
    if (returned) clearBillingReturn();
    if (!waiting) return;
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      reloadLeague();
      if (tries >= 15) { clearInterval(t); setWaiting(false); }
    }, 2000);
    return () => clearInterval(t);
  }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (league.effectivePlan !== 'free') setWaiting(false); }, [league.effectivePlan]);
  // Arriving from an upgrade card ("See Pro"): bring the plan into view.
  useEffect(() => { if (window.location.hash === '#plan') document.getElementById('plan')?.scrollIntoView({ block: 'start' }); }, []);
  const interest = useAsync(async () => (league.effectivePlan === 'free' ? api.upgradeInterest(league.id) : null), [league.id, league.effectivePlan]);

  const go = async (getUrl: () => Promise<string>) => {
    const url = await run(getUrl);
    if (url) window.location.assign(url);
  };
  const b = billing.data;
  const plan = league.effectivePlan;
  const sub = b?.subscription;

  return (
    <section className="card stack plan-card" id="plan">
      <div className="row between wrap">
        <h2>Plan</h2>
        <span className={`badge ${plan === 'free' ? 'badge-neutral' : 'badge-pro'}`}>{PLAN_LABEL[plan]}</span>
      </div>

      {waiting && <p className="notice">Payment received. Turning on Pro… this takes a few seconds.</p>}
      {returned === 'cancelled' && plan === 'free' && <p className="small muted">Checkout was cancelled. Nothing was charged.</p>}

      {plan === 'pilot' && <p>Your league is a <strong>GolfScoreHQ pilot</strong>: every Pro feature is free through 2027. Thank you for helping us build it.</p>}
      {plan === 'comp' && <p>Every Pro feature is on for your league, free.</p>}
      {plan === 'club' && (
        <p>
          Covered by the Course plan for <strong>{b?.clubName ?? 'your course'}</strong>{b?.expiresAt ? `, paid through ${fmtDay(b.expiresAt)}` : ''}.
          {b?.isOwner && <> See it on <Link to="/leagues">Your leagues</Link>.</>}
        </p>
      )}

      {plan === 'pro' && !sub && <p>Pro is on{b?.expiresAt ? ` through ${fmtDay(b.expiresAt)}` : ''}.</p>}
      {plan === 'pro' && sub && (
        <>
          {sub.status === 'past_due' ? (
            <p className="warn">Your card didn't go through for the renewal. Update it to keep Pro.</p>
          ) : sub.cancelAtPeriodEnd ? (
            <p>Pro ends on <strong>{sub.renewsAt ? fmtDay(sub.renewsAt) : 'the end of the paid year'}</strong>. It won't renew.</p>
          ) : (
            <p>Pro renews on <strong>{sub.renewsAt ? fmtDay(sub.renewsAt) : 'its renewal date'}</strong> for {PRICE.pro} a year.</p>
          )}
          {sub.paidByMe ? (
            <div><button className="btn" disabled={busy} onClick={() => go(() => api.billingPortal(`/l/${league.slug}/settings`))}>{busy ? 'Opening…' : 'Manage billing'}</button></div>
          ) : (
            <p className="small muted">Billing is handled by the commissioner who paid.</p>
          )}
          <p className="small muted">Manage billing opens Stripe, where you can update the card, get receipts or cancel. If you cancel, Pro stays on until the paid year ends.</p>
        </>
      )}

      {plan === 'free' && !waiting && (
        <>
          <p>You're on <strong>Free</strong>: scoring, live leaderboard, standings and your roster, for any number of golfers.</p>
          <div className="upgrade">
            <div className="row between wrap">
              <strong>GolfScoreHQ Pro</strong>
              <span><span className="num upgrade-price">{PRICE.pro}</span> <span className="small muted">per league, per year</span></span>
            </div>
            <ul className="ticks small">{PRO_PERKS.map((p) => <li key={p}>{p}</li>)}</ul>
            {interest.data && interest.data.count > 0 && (
              <p className="notice small">
                <strong>{namesLine(interest.data.names)}</strong> {interest.data.count === 1 ? 'says they' : 'say they'}'d chip in for the season: {fmtMoney(interest.data.totalCents)} of {PRICE.pro} so far.
              </p>
            )}
            <div><button className="btn btn-primary" disabled={busy} onClick={() => go(() => api.startCheckout({ leagueId: league.id }))}>{busy ? 'Opening checkout…' : `Upgrade to Pro, ${PRICE.pro}/year`}</button></div>
            <p className="small muted">
              Secure checkout by Stripe. Renews yearly; cancel anytime. Full refund within 14 days. Have a discount code? Enter it at checkout.
              By upgrading you agree to the <Link to="/terms">Terms</Link> and <Link to="/refunds">Refund Policy</Link>.
            </p>
          </div>
          <p className="small muted">Run a golf course? The <strong>Course plan</strong> covers every league at your course. <Link to="/courses">For golf courses</Link></p>
          <PilotCodeEntry />
        </>
      )}
      <ErrorText>{error ?? billing.error}</ErrorText>
    </section>
  );
}
