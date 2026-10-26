import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { friendlyError } from './api';
import { api } from './backend';
import type { League, User } from './types';

export function useAuthState() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    api.currentUser().then((u) => {
      if (live) {
        setUser(u);
        setLoading(false);
      }
    });
    const off = api.onAuthChange((u) => {
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

/** Load data for a screen; `reload()` after a change. Errors come back as plain sentences. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(() => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => n === seq.current && setState({ data, error: null, loading: false }),
      (e) => n === seq.current && setState({ data: undefined, error: friendlyError(e), loading: false }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { ...state, reload: run };
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
      setError(friendlyError(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
