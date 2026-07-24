import { createJobDropClient } from '@jobdrop/api-client';
import { AppState, Platform } from 'react-native';
import { sessionStorage } from './session-storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = createJobDropClient({
  url,
  anonKey,
  ...(sessionStorage ? { storage: sessionStorage } : {}),
  // On native the OAuth result arrives through a deep link we handle ourselves;
  // letting supabase-js also scan URLs makes it consume links meant for the router.
  detectSessionInUrl: Platform.OS === 'web',
});

/**
 * supabase-js refreshes tokens on a timer, and timers do not fire while an app
 * is backgrounded. Without this, a user returning after an hour makes their
 * first request with a stale token. Tie refreshing to foreground state instead.
 */
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  });
}
