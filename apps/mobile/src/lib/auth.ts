import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { supabase } from './supabase';

/**
 * Sign-in.
 *
 * Google goes through expo-auth-session rather than the native
 * @react-native-google-signin module. That module needs a custom dev build;
 * AuthSession works in Expo Go and on web with the same code. Revisit at M3,
 * when the share extension and the Android bubble force a dev build anyway —
 * native Google sign-in is a better gesture (one tap, no browser hop) and the
 * swap is contained to this file.
 *
 * Apple is required by App Store review once any third-party sign-in is offered.
 */

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

function googleClientId(): string {
  const id =
    Platform.select({
      ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
      android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
      default: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    }) ?? '';

  if (!id) {
    throw new Error(
      'Missing Google client ID for this platform. See .env.example — you need three OAuth clients (iOS, Android, web) from the Google Cloud console.',
    );
  }
  return id;
}

export type AuthOutcome = 'signed-in' | 'cancelled';

export async function signInWithGoogle(): Promise<AuthOutcome> {
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'jobdrop' });

  const request = new AuthSession.AuthRequest({
    clientId: googleClientId(),
    redirectUri,
    scopes: ['openid', 'profile', 'email'],
    // id_token is what Supabase verifies; the access token is not needed.
    responseType: AuthSession.ResponseType.IdToken,
    extraParams: { nonce: 'jobdrop' },
  });

  const result = await request.promptAsync(GOOGLE_DISCOVERY);
  if (result.type !== 'success') return 'cancelled';

  const idToken = result.params.id_token;
  if (!idToken) throw new Error('Google did not return an identity token.');

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
    nonce: 'jobdrop',
  });
  if (error) throw new Error(`Google sign-in failed: ${error.message}`);
  return 'signed-in';
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
