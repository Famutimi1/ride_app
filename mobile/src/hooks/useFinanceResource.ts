import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { apiErrorMessage } from '@/lib/apiClient';
import { useAuthStore } from '@/store/authStore';
import { useWalletStore } from '@/store/walletStore';

export interface FinanceResource<T> { data: T | null; revision: number; loading: boolean; error: string | null; refresh: () => Promise<void> }

/** Independent read states, refreshed on foreground; late responses never replace newer data. */
export function useFinanceResource<T>(loader: () => Promise<T>): FinanceResource<T> {
  const userId = useAuthStore(state => state.session?.user.id);
  const role = useAuthStore(state => state.session?.user.role);
  const [state, setState] = useState<{ data: T | null; revision: number; loading: boolean; error: string | null; owner: typeof loader; userId: typeof userId; role: typeof role }>({ data: null, revision: 0, loading: true, error: null, owner: loader, userId, role });
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const key = ++generation.current;
    const user = useAuthStore.getState().session?.user;
    if (!userId || user?.id !== userId || user.role !== role) return;
    const isCurrent = () => {
      const current = useAuthStore.getState().session?.user;
      return key === generation.current && current?.id === userId && current.role === role;
    };
    setState(current => ({ ...current, loading: true, error: null, owner: loader, userId, role }));
    try {
      const data = await loader();
      if (isCurrent()) setState(current => ({ data, revision: current.revision + 1, loading: false, error: null, owner: loader, userId, role }));
    } catch (reason) {
      if (isCurrent()) setState(current => ({ ...current, loading: false, error: apiErrorMessage(reason) }));
    }
  }, [loader, userId, role]);
  useEffect(() => {
    setState({ data: null, revision: 0, loading: true, error: null, owner: loader, userId, role });
    void refresh();
    const subscription = AppState.addEventListener('change', status => { if (status === 'active') void refresh(); });
    return () => { generation.current += 1; subscription.remove(); };
  }, [refresh, loader, userId, role]);
  const current = state.owner === loader && state.userId === userId && state.role === role;
  return { data: current ? state.data : null, revision: state.revision, loading: !current || state.loading, error: current ? state.error : null, refresh };
}

/** The wallet store remains the balance source; local state only tracks first-read readiness. */
export function useDriverBalance() {
  const wallet = useWalletStore();
  const [ready, setReady] = useState(false);
  const refresh = useWalletStore(state => state.refresh);
  useEffect(() => {
    let active = true;
    const load = () => { void refresh().then(() => { if (active) setReady(true); }); };
    load();
    const subscription = AppState.addEventListener('change', status => { if (status === 'active') load(); });
    return () => { active = false; subscription.remove(); };
  }, [refresh]);
  return { ...wallet, loading: !ready || wallet.loading };
}

/** One in-flight mutation per form, including before React commits its next render. */
export function useFinanceAction() {
  const ownerId = useAuthStore(state => state.session?.user.id);
  const ownerRole = useAuthStore(state => state.session?.user.role);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = async <T,>(kind: string, job: () => Promise<T>, success: (value: T) => void, switchesMode = false) => {
    const user = useAuthStore.getState().session?.user;
    if (!user || user.id !== ownerId || user.role !== ownerRole || inFlight.current || !mounted.current) return;
    const isCurrent = () => {
      const current = useAuthStore.getState().session?.user;
      return mounted.current && current?.id === user.id && (switchesMode || current.role === ownerRole);
    };
    inFlight.current = true; setBusy(kind); setError(null);
    try {
      const value = await job();
      if (isCurrent()) success(value);
    } catch (reason) {
      if (isCurrent()) setError(apiErrorMessage(reason));
    } finally { inFlight.current = false; if (mounted.current) setBusy(null); }
  };
  return { busy, error, setError, run, inFlight };
}
