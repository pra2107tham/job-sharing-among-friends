import { NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/**
 * The bridge between JS and the two native capture surfaces (doc 1 §4).
 *
 * Both surfaces have the same job: accept a link the instant the user gestures,
 * persist it, and get out of the way. Neither can rely on the React Native
 * runtime being alive — the Android bubble runs while the app is dead, and the
 * iOS Share Extension is a separate process entirely. So each keeps its own
 * on-disk queue in native code, and JS drains whatever is left over on launch.
 *
 * `requireOptionalNativeModule` rather than `requireNativeModule`: this module
 * does not exist in Expo Go or on web, and the app has to keep working there.
 * Every function below degrades to a no-op instead of throwing.
 */

/** One entry from a native queue, shaped the way share_job wants it. */
export type NativeShare = {
  clientShareId: string;
  rawInput: string;
  /** epoch millis, for ordering when both queues have entries */
  queuedAt: number;
  source: 'bubble' | 'share-sheet' | 'share-extension';
};

/** Credentials the native side needs to POST without booting JS. */
export type NativeCredentials = {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  refreshToken: string;
  /** epoch seconds */
  expiresAt: number;
  userId: string;
};

declare class JobDropShareNativeModule extends NativeModule {
  /** Android: has the user granted SYSTEM_ALERT_WINDOW? */
  canDrawOverlay(): boolean;
  /** Android: opens the system settings page for the overlay grant. */
  requestOverlayPermission(): void;
  /** Android: start/stop the foreground service that hosts the bubble. */
  startBubble(): void;
  stopBubble(): void;
  isBubbleRunning(): boolean;

  /** Hand the native side what it needs to send on its own. */
  setCredentials(credentials: NativeCredentials): void;
  clearCredentials(): void;

  /** Take everything the native queue is holding, and empty it. */
  drainQueue(): NativeShare[];
  pendingCount(): number;
}

const native = requireOptionalNativeModule<JobDropShareNativeModule>('JobDropShare');

/** True when the native module is actually present (a dev/production build). */
export const isNativeShareAvailable = native !== null;

/**
 * The bubble is Android-only, and permanently so. iOS does not let an app draw
 * over other apps — see doc 1 §4.1. Callers should use this to decide what to
 * render rather than checking Platform.OS themselves.
 */
export const supportsBubble = Platform.OS === 'android' && isNativeShareAvailable;

export function canDrawOverlay(): boolean {
  return native?.canDrawOverlay() ?? false;
}

export function requestOverlayPermission(): void {
  native?.requestOverlayPermission();
}

export function startBubble(): void {
  native?.startBubble();
}

export function stopBubble(): void {
  native?.stopBubble();
}

export function isBubbleRunning(): boolean {
  return native?.isBubbleRunning() ?? false;
}

export function setNativeCredentials(credentials: NativeCredentials): void {
  native?.setCredentials(credentials);
}

export function clearNativeCredentials(): void {
  native?.clearCredentials();
}

/**
 * Everything the native surfaces captured while JS was not running. Returns an
 * empty array when the module is absent, so callers need no platform branch.
 */
export function drainNativeQueue(): NativeShare[] {
  return native?.drainQueue() ?? [];
}

export function nativePendingCount(): number {
  return native?.pendingCount() ?? 0;
}
