import { useEffect, useState } from 'react';
import { useNoSignal } from '../lib/offline';
import { flushAll, onQueueChange, waitingElsewhere } from '../lib/pendingQueue';

/**
 * Signed in: sends scores waiting on this phone from any screen (the moment
 * signal is back, every 20 seconds while something waits, and when the app
 * opens), and says so when there's no signal.
 */
export function OfflineBar() {
  const noSignal = useNoSignal();
  const [waiting, setWaiting] = useState(waitingElsewhere);

  useEffect(() => {
    const count = () => setWaiting(waitingElsewhere());
    const send = () => { void flushAll().finally(count); };
    const off = onQueueChange(count);
    const visible = () => { if (document.visibilityState === 'visible') send(); };
    window.addEventListener('online', send);
    document.addEventListener('visibilitychange', visible);
    const t = setInterval(() => { if (waitingElsewhere()) send(); }, 20_000);
    send();
    return () => { off(); clearInterval(t); window.removeEventListener('online', send); document.removeEventListener('visibilitychange', visible); };
  }, []);

  if (!noSignal && !waiting) return null;
  return (
    <div className="offline-bar" role="status">
      {noSignal ? <strong>No signal.</strong> : <strong>Sending…</strong>}{' '}
      {waiting
        ? `Scores for ${waiting === 1 ? 'a group are' : `${waiting} groups are`} saved on this phone and will send by themselves when there's signal.`
        : 'Showing what was last loaded. You can keep scoring; scores save on this phone.'}
    </div>
  );
}
