// The app telling us about its own problems: crashes, screens that couldn't
// load, actions that failed, and "Report a problem" notes. Staff see them on
// /staff, grouped, and a daily email flags anything new.
import { api } from './backend';
import type { AppErrorReport } from './types';

declare const __APP_VERSION__: string;
/** When this copy of the app was built (shows which version a problem happened on). */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** Not worth reporting: no signal on the course, or a plan or permission message the person was meant to see. */
export function worthReporting(message: string): boolean {
  if (!message.trim()) return false;
  if (/failed to fetch|networkerror|load failed|network request failed|the internet connection appears to be offline|fetch failed/i.test(message)) return false;
  if (/GolfScoreHQ Pro|plan lapsed|Only commissioners can|Sign in first|ResizeObserver loop/i.test(message)) return false;
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

const recent = new Map<string, number>();

/** Report a problem (at most once a minute for the same message). Never throws. */
export function reportProblem(kind: AppErrorReport['kind'], message: string, detail?: string | null) {
  if (kind !== 'report' && !worthReporting(message)) return;
  const now = Date.now();
  const key = `${kind}:${message}`;
  if (kind !== 'report' && now - (recent.get(key) ?? 0) < 60_000) return;
  recent.set(key, now);
  const path = typeof location === 'undefined' ? null : location.pathname;
  void api.logAppError({
    kind, message: message.slice(0, 500), detail: detail?.slice(0, 4000) ?? null, path, appVersion: APP_VERSION,
    userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
    leagueSlug: path?.match(/^\/l\/([^/]+)/)?.[1] ?? null,
  }).catch(() => undefined);
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e) ?? String(e));
const stackOf = (e: unknown) => (e instanceof Error ? e.stack ?? null : null);

/** Crash reports from anywhere in the app, and the "I have the app open" heartbeat. Called once at startup. */
export function installDiagnostics() {
  window.addEventListener('error', (ev) => reportProblem('error', ev.message || errorText(ev.error), stackOf(ev.error) ?? `${ev.filename}:${ev.lineno}`));
  window.addEventListener('unhandledrejection', (ev) => reportProblem('error', errorText(ev.reason), stackOf(ev.reason)));
  if (api.mode === 'demo') return;
  const beat = () => { if (document.visibilityState === 'visible') void api.heartbeat(); };
  beat();
  window.setInterval(beat, 2 * 60_000);
  document.addEventListener('visibilitychange', beat);
}
