import { useEffect, useState } from 'react';
import { api } from '../lib/backend';
import { useAction } from '../lib/hooks';
import { currentSubscription, pushSupport, subscribe, subscriptionKeys } from '../lib/push';
import { ErrorText } from './ui';

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
              const ok = await run(async () => {
                const key = await api.pushKey();
                if (!key) throw new Error("Phone notifications aren't available yet.");
                await api.savePushDevice(subscriptionKeys(await subscribe(key)));
                return true;
              });
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
