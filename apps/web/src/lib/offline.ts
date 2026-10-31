import { useEffect, useState } from 'react';

// No signal on the course. Phones often say they're online with one bar and
// nothing getting through, so "no signal" is what the last request found, not
// just navigator.onLine.

/** A request that failed because nothing reached the server (not a refusal). */
export const isNetworkError = (e: unknown) =>
  /fetch|load failed|network|offline|timed? ?out|aborted|Retryable/i.test(
    e instanceof Error ? `${e.name} ${e.message}` : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e),
  );

let noSignal = typeof navigator !== 'undefined' && navigator.onLine === false;
const listeners = new Set<() => void>();
const set = (v: boolean) => {
  if (v === noSignal) return;
  noSignal = v;
  listeners.forEach((l) => l());
};

/** Requests report here: a network failure means no signal, any answer from the server means signal. */
export function sawNoSignal() { set(true); }
export function sawSignal() { set(false); }

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => set(true));
  window.addEventListener('online', () => set(false));
}

export function useNoSignal(): boolean {
  const [v, setV] = useState(noSignal);
  useEffect(() => {
    const l = () => setV(noSignal);
    listeners.add(l);
    l();
    return () => { listeners.delete(l); };
  }, []);
  return v;
}

/**
 * Let the app open with no signal: the service worker keeps the app's files.
 * Registered in production only (the dev server's files change on every save).
 * Once it's running, it's handed everything this visit already downloaded, so
 * even the first visit leaves a copy that works offline.
 */
export function installOfflineApp() {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* private mode or blocked: the app still works online */ });
    // After the pages download in the background (prefetchPages), hand the worker the list.
    setTimeout(() => {
      void navigator.serviceWorker.ready.then((reg) => {
        const urls = performance.getEntriesByType('resource').map((r) => r.name)
          .filter((u) => u.startsWith(`${location.origin}/assets/`));
        reg.active?.postMessage({ type: 'keep', urls: [...new Set(urls)] });
      });
    }, 8000);
  });
}
