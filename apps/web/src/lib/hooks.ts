import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { friendlyError } from './api';
import { api } from './backend';
import { cached, cacheKey, remember, setCacheOwner } from './cache';
import { reportProblem, worthReporting } from './diagnostics';
import type { League, User } from './types';

export function useAuthState() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    api.currentUser().then((u) => {
      if (live) {
        setCacheOwner(u?.id ?? null);
        setUser(u);
        setLoading(false);
      }
    });
    const off = api.onAuthChange((u) => {
      setCacheOwner(u?.id ?? null);
      setUser(u);
      setLoading(false);
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  return { user, loading };
}

export const AuthContext = createContext<{ user: User | null; loading: boolean }>({ user: null, loading: true });
export const useAuth = () => useContext(AuthContext);

export const LeagueContext = createContext<{ league: League; reloadLeague: () => void } | null>(null);
export function useLeague() {
  const ctx = useContext(LeagueContext);
  if (!ctx) throw new Error('useLeague outside a league page');
  return ctx;
}

/**
 * Load data for a screen; `reload()` after a change. Errors come back as plain sentences.
 * What the screen loaded last time shows straight away (`loading` stays true
 * while the fresh copy arrives), so going back to a page or reopening the app doesn't wait.
 * `fresh`: always wait for the server (screens that set themselves up once from the first data, like scoring).
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], opts: { fresh?: boolean } = {}) {
  const key = opts.fresh ? null : cacheKey(fn, deps);
  // stale: showing what was remembered from last time; the fresh copy hasn't arrived yet.
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loading: boolean; stale: boolean }>(() => {
    const data = cached<T>(key);
    return { data, error: null, loading: true, stale: data !== undefined };
  });
  const seq = useRef(0);
  const run = useCallback(() => {
    const n = ++seq.current;
    // New inputs (another week, another golfer): show what we had for those, if anything.
    setState((s) => {
      if (n === 1) return { ...s, loading: true };
      const remembered = cached<T>(key);
      return remembered !== undefined ? { data: remembered, error: null, loading: true, stale: true } : { ...s, error: null, loading: true };
    });
    fn().then(
      (data) => { if (n !== seq.current) return; remember(key, data); setState({ data, error: null, loading: false, stale: false }); },
      (e) => {
        if (n !== seq.current) return;
        reportFailure('error', 'A screen could not load', e);
        setState({ data: undefined, error: friendlyError(e), loading: false, stale: false });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { ...state, reload: run };
}

/** Re-run `reload` when the league's scoring data changes, with a slow poll as a safety net. */
export function useLiveRefresh(leagueId: string, reload: () => void, enabled = true) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const bump = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { reload(); setUpdatedAt(new Date()); }, 600);
    };
    const off = api.watchLeague(leagueId, bump);
    const poll = setInterval(() => { if (document.visibilityState === 'visible') bump(); }, 30000);
    return () => { off(); clearInterval(poll); if (timer.current) clearTimeout(timer.current); };
  }, [leagueId, reload, enabled]);
  return updatedAt;
}

/**
 * Tell staff about a failure, unless it's one the person was meant to see (a
 * plan message, no signal). Grouped by the underlying message; what the person
 * was shown goes in the details.
 */
function reportFailure(kind: 'error' | 'failed_action', what: string, e: unknown) {
  const raw = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  const shown = friendlyError(e);
  if (!worthReporting(raw) || !worthReporting(shown)) return;
  reportProblem(kind, raw, `${what}. Shown: "${shown}"${e instanceof Error && e.stack ? `\n${e.stack}` : ''}`);
}

/** Wrap an action: tracks busy state and turns failures into a message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      reportFailure('failed_action', 'An action failed', e);
      setError(friendlyError(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
