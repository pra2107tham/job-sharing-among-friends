import { getMyProfile, isOnboarded } from '@jobdrop/api-client';
import type { ProfileRow } from '@jobdrop/contracts';
import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';

/**
 * Session state for the whole app.
 *
 * Three states the router cares about, and they are deliberately distinct:
 *   loading      — we do not yet know; render nothing rather than flashing the
 *                  sign-in screen at an already-authenticated user
 *   signed out   — no session
 *   signed in    — session, plus a profile that may or may not be onboarded
 */

type SessionState = {
  loading: boolean;
  session: Session | null;
  profile: ProfileRow | null;
  refreshProfile: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);

  async function loadProfile(next: Session | null) {
    if (!next) {
      setProfile(null);
      return;
    }
    try {
      setProfile(await getMyProfile(supabase));
    } catch {
      // A profile read can fail transiently (offline at cold start). Leaving it
      // null routes to onboarding, which re-reads — better than crashing here.
      setProfile(null);
    }
  }

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (active) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      void loadProfile(next);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      loading,
      session,
      profile,
      refreshProfile: () => loadProfile(session),
    }),
    [loading, session, profile],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside a SessionProvider');
  return ctx;
}

export { isOnboarded };
