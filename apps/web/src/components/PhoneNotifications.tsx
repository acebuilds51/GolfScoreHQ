import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/backend';
import { useAction } from '../lib/hooks';
import { currentSubscription, pushSupport, subscribe, subscriptionKeys } from '../lib/push';
import { ErrorText } from './ui';

/** Ask permission, subscribe this phone and save it. */
async function turnOn() {
  const key = await api.pushKey();
  if (!key) throw new Error("Phone notifications aren't available yet.");
  await api.savePushDevice(subscriptionKeys(await subscribe(key)));
}

const DISMISS_KEY = 'gshq-notify-prompt';
const DISMISS_DAYS = 21;
const dismissedRecently = () => {
  try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) ?? 0) < DISMISS_DAYS * 86_400_000; } catch { return false; }
};

/**
 * One tap to turn notifications on, across the top of league pages, for
 * anyone who hasn't yet. Phones only allow it after the person says yes, so
 * this is as close to "on by default" as a website can get. "Not now" hides
 * it for three weeks; blocked or already on, it never shows.
 */
export function NotificationPrompt({ moreLink }: { moreLink: string }) {
  const support = pushSupport();
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (dismissedRecently()) return;
    if (support === 'ios-browser') { setShow(true); return; }
    if (support !== 'ok' || Notification.permission === 'denied') return;
    currentSubscription().then((s) => setShow(!s || Notification.permission !== 'granted'), () => {});
  }, [support]);

  if (!show) return null;
  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* not saved */ } setShow(false); };
  if (done) return <div className="notify-prompt page"><span className="good">Notifications are on for this phone ✓</span></div>;
  return (
    <div className="notify-prompt page" role="region" aria-label="Notifications">
      {support === 'ios-browser' ? (
        <span className="grow small">Get "Are you playing?" reminders and results on your iPhone: <Link to={moreLink}>add GolfScoreHQ to your Home Screen</Link>, then turn notifications on there.</span>
      ) : (
        <>
          <span className="grow small">Get "Are you playing?" reminders and results as notifications on this phone.</span>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { const ok = await run(async () => { await turnOn(); return true; }); if (ok) { setDone(true); setTimeout(() => setShow(false), 3000); } }}>Turn on</button>
        </>
      )}
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={dismiss}>Not now</button>
      {error && <span className="small error notify-error">{error}</span>}
    </div>
  );
}

/** Turn phone notifications on or off for this device (reminders, results). */
export function PhoneNotifications() {
  const support = pushSupport();
  const [on, setOn] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (support !== 'ok') return;
    currentSubscription().then((s) => setOn(!!s && Notification.permission === 'granted'), () => setOn(false));
  }, [support]);

  if (support === 'unsupported') return null;
  return (
    <section className="card stack">
      <h2>Notifications on this phone</h2>
      {support === 'ios-browser' ? (
        <p className="small muted">
          On iPhone, add GolfScoreHQ to your Home Screen first (Share button → Add to Home Screen), open it from there, and turn notifications on here.
        </p>
      ) : on === null ? null : on ? (
        <>
          <p className="small">On: you'll get "Are you playing?" reminders and "results are in" on this phone.</p>
          <div className="row wrap">
            <button className="btn btn-sm" disabled={busy} onClick={async () => {
              const n = await run(() => api.testPush());
              if (n !== undefined) setNote(n ? 'Sent. It should show up in a few seconds.' : "Nothing was sent. Turn notifications off and on again.");
            }}>Send me a test</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => {
              const ok = await run(async () => {
                const s = await currentSubscription();
                if (s) { await api.removePushDevice(s.endpoint); await s.unsubscribe(); }
                return true;
              });
              if (ok) { setOn(false); setNote(null); }
            }}>Turn off</button>
          </div>
        </>
      ) : (
        <>
          <p className="small muted">Get "Are you playing?" reminders and "results are in" as notifications, free.</p>
          <div>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={async () => {
              const ok = await run(async () => { await turnOn(); return true; });
              if (ok) { setOn(true); setNote(null); }
            }}>Turn on notifications</button>
          </div>
        </>
      )}
      {note && <p className="small good">{note}</p>}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
