import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import { getQueryParams } from 'expo-auth-session/build/QueryParams';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { supabase } from './supabase';

/**
 * Sign-in.
 *
 * Google goes through Supabase's OAuth endpoint in a browser rather than talking
 * to Google directly. That is a deliberate trade:
 *
 *   - The Google client ID and secret live in the Supabase dashboard, not in
 *     this app. Setup drops from three OAuth clients to one, and no Google
 *     credential ships in the bundle.
 *   - It works in Expo Go. Talking to Google directly needs a custom URL scheme
 *     as the redirect, which Google rejects for a Web client and which Expo Go
 *     cannot provide anyway (it hands out `exp://…`).
 *   - PKCE is handled by supabase-js, so there is no hand-rolled nonce.
 *
 * The cost is a browser hop instead of the native account picker. Swap to
 * @react-native-google-signin at M3, when the share extension forces a dev build
 * anyway — the change is contained to this file.
 *
 * Apple stays native because expo-apple-authentication returns an identity token
 * directly, and Apple requires the native sheet for App Store review.
 */

WebBrowser.maybeCompleteAuthSession();

export type AuthOutcome = 'signed-in' | 'cancelled';

/** Where Supabase sends the browser back to once Google is done. */
function redirectUri(): string {
  return AuthSession.makeRedirectUri({ scheme: 'jobdrop', path: 'auth-callback' });
}

export async function signInWithGoogle(): Promise<AuthOutcome> {
  // On web the page itself navigates to Google and back; supabase-js picks the
  // session out of the returned URL because detectSessionInUrl is on.
  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw new Error(`Google sign-in failed: ${error.message}`);
    return 'signed-in';
  }

  const redirectTo = redirectUri();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    // We open the browser ourselves so we can await the result and read the
    // callback URL; letting supabase-js redirect would lose control of it.
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw new Error(`Google sign-in failed: ${error.message}`);
  if (!data.url) throw new Error('Supabase did not return an authorization URL.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return 'cancelled';

  const { params, errorCode } = getQueryParams(result.url);
  if (errorCode) throw new Error(`Google sign-in failed: ${errorCode}`);

  // PKCE returns ?code=…; a project still on the implicit flow returns tokens
  // in the fragment. Handle both so this does not break on either setting.
  if (params.code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code);
    if (exchangeError) throw new Error(`Google sign-in failed: ${exchangeError.message}`);
    return 'signed-in';
  }

  if (params.access_token && params.refresh_token) {
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });
    if (sessionError) throw new Error(`Google sign-in failed: ${sessionError.message}`);
    return 'signed-in';
  }

  throw new Error('Google sign-in returned no session. Check the Supabase redirect allow list.');
}

export async function signInWithApple(): Promise<AuthOutcome> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  }).catch((err: unknown) => {
    // Apple reports user cancellation as a thrown ERR_REQUEST_CANCELED.
    if (typeof err === 'object' && err !== null && 'code' in err) {
      if ((err as { code: string }).code === 'ERR_REQUEST_CANCELED') return null;
    }
    throw err;
  });

  if (!credential?.identityToken) return 'cancelled';

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) throw new Error(`Apple sign-in failed: ${error.message}`);
  return 'signed-in';
}

/** Apple sign-in only exists on iOS 13+; hide the button everywhere else. */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  return AppleAuthentication.isAvailableAsync();
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(`Sign out failed: ${error.message}`);
}
