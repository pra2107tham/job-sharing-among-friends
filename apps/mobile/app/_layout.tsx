import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading } from '@/components/ui';
import { drainNativeShares, syncNativeCredentials } from '@/lib/native-share';
import { flushOutbox } from '@/lib/outbox';
import { isOnboarded, SessionProvider, useSession } from '@/lib/session';
import '../global.css';

/**
 * The auth gate.
 *
 * Redirects live here rather than in each screen so there is exactly one place
 * that decides where an unauthenticated or half-onboarded user ends up.
 */
function Gate() {
  const { loading, session, profile } = useSession();
  // Cast: typedRoutes narrows useSegments() to the tuple shapes that currently
  // exist, so indexing past the first element fails to compile as routes are
  // added and removed. The gate only needs the raw path segments.
  const segments = useSegments() as string[];
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    // An invite link must survive being opened by a signed-out user: they land
    // on /j/<code>, get bounced to sign-in, and the router returns them here.
    const isPublicInvite = segments[0] === 'j';

    if (!session) {
      if (!inAuthGroup) router.replace('/(auth)/sign-in');
      return;
    }

    if (!isOnboarded(profile)) {
      if (segments[1] !== 'onboarding') router.replace('/(auth)/onboarding');
      return;
    }

    if (inAuthGroup && !isPublicInvite) router.replace('/(tabs)');
  }, [loading, session, profile, segments, router]);

  // The native surfaces need a token to send on their own, and they hold onto
  // anything they could not deliver. Both directions are handled here, on every
  // session change and every return to the foreground.
  useEffect(() => {
    if (!session) {
      syncNativeCredentials(null);
      return;
    }

    syncNativeCredentials(session);

    const catchUp = () => {
      // Native queue first, so bubble captures keep their place in line ahead
      // of anything queued in-app afterwards.
      void drainNativeShares().then(() => flushOutbox());
    };

    catchUp();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') catchUp();
    });
    return () => sub.remove();
  }, [session]);

  // Render nothing until the session is known, so an already-signed-in user
  // never sees the sign-in screen flash.
  if (loading) return <Loading />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="share" options={{ presentation: 'modal' }} />
      <Stack.Screen name="group/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="group/[id]/index" />
      <Stack.Screen name="group/[id]/invite" />
      <Stack.Screen name="group/[id]/settings" />
      <Stack.Screen name="job/[id]" />
      <Stack.Screen name="j/[code]" />
      <Stack.Screen name="capture" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="auto" />
        <Gate />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
