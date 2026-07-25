import { buildShareInput } from '@jobdrop/api-client';
import * as Crypto from 'expo-crypto';
import type { Session } from '@supabase/supabase-js';
import {
  clearNativeCredentials,
  drainNativeQueue,
  isNativeShareAvailable,
  setNativeCredentials,
} from '../../modules/jobdrop-share';
import { enqueueShare } from './outbox';

/**
 * Keeps the native capture surfaces usable, and folds what they captured back
 * into the app.
 *
 * Two directions:
 *
 *   JS → native   the access token, so the bubble and the Share Extension can
 *                 POST without the app running at all.
 *   native → JS   anything they captured but could not deliver, replayed
 *                 through the normal outbox on next launch.
 *
 * Both are no-ops in Expo Go and on web, where the native module is absent.
 */

const sha256 = (input: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input);

/**
 * Hand the current session to the native side.
 *
 * This is the one place a token crosses out of the JS runtime. It is written to
 * EncryptedSharedPreferences on Android and the App Group container on iOS —
 * both readable only by this app and its extension.
 */
export function syncNativeCredentials(session: Session | null): void {
  if (!isNativeShareAvailable) return;

  if (!session) {
    clearNativeCredentials();
    return;
  }

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!url || !anonKey) return;

  setNativeCredentials({
    supabaseUrl: url,
    anonKey,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? 0,
    userId: session.user.id,
  });
}

/**
 * Move everything the native surfaces are holding into the JS outbox.
 *
 * The native `clientShareId` is carried over deliberately. If the bubble
 * already delivered a share and only failed to remove it from its own queue,
 * replaying it here collapses server-side rather than double-posting —
 * share_job is idempotent on (sharer_id, client_share_id).
 *
 * Returns how many were taken, so the UI can say something honest.
 */
export async function drainNativeShares(): Promise<number> {
  if (!isNativeShareAvailable) return 0;

  const entries = drainNativeQueue();
  if (entries.length === 0) return 0;

  // Oldest first, so the order the user shared in survives.
  const ordered = [...entries].sort((a, b) => a.queuedAt - b.queuedAt);

  for (const entry of ordered) {
    try {
      const input = await buildShareInput(entry.rawInput, sha256, {
        clientShareId: entry.clientShareId,
      });
      await enqueueShare(input);
    } catch {
      // One malformed entry must not strand the rest of the queue.
      continue;
    }
  }

  return ordered.length;
}
