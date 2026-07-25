import type { Database } from '@jobdrop/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type JobDropClient = SupabaseClient<Database>;

/**
 * Where the session is persisted. React Native has no localStorage, so the app
 * passes an adapter (SecureStore / AsyncStorage) and the web build passes
 * nothing, letting supabase-js use localStorage.
 */
export interface SessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface CreateClientOptions {
  url: string;
  anonKey: string;
  storage?: SessionStorage;
  /**
   * React Native cannot use the URL-based OAuth callback detection that the web
   * build relies on, and leaving it enabled makes the client parse deep links it
   * should ignore. Callers on native pass false.
   */
  detectSessionInUrl?: boolean;
}

export function createJobDropClient({
  url,
  anonKey,
  storage,
  detectSessionInUrl = true,
}: CreateClientOptions): JobDropClient {
  if (!url || !anonKey) {
    // Failing loudly here beats a stream of confusing 401s at the first query.
    throw new Error(
      'Supabase URL and anon key are required. Copy .env.example to .env and fill them in.',
    );
  }

  return createClient<Database>(url, anonKey, {
    auth: {
      ...(storage ? { storage } : {}),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl,
      // PKCE, so the OAuth callback returns a code we exchange rather than
      // tokens in a URL fragment. Required by exchangeCodeForSession in
      // apps/mobile/src/lib/auth.ts, and the safer flow on mobile regardless.
      flowType: 'pkce',
    },
  });
}
