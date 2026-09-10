import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError, type Session } from './api';

interface SessionContextValue {
  session: Session | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: string) => boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSession(await api.get<Session>('/me'));
    } catch (error) {
      // A 401 simply means "not signed in"; anything else is worth surfacing.
      if (!(error instanceof ApiError) || error.status !== 401) console.error(error);
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    await api.post('/auth/login', { email, password });
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setSession(null);
    }
  }, []);

  const can = useCallback(
    (permission: string) => Boolean(session?.access.permissions.includes(permission)),
    [session],
  );

  const value = useMemo(
    () => ({ session, loading, refresh, signIn, signOut, can }),
    [session, loading, refresh, signIn, signOut, can],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside a SessionProvider');
  return context;
}
