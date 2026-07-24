import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading } from '@/components/ui';
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

    if (!session) {
      if (!inAuthGroup) router.replace('/(auth)/sign-in');
      return;
    }

    if (!isOnboarded(profile)) {
      if (segments[1] !== 'onboarding') router.replace('/(auth)/onboarding');
      return;
    }

    if (inAuthGroup) router.replace('/(tabs)');
  }, [loading, session, profile, segments, router]);

  // Render nothing until the session is known, so an already-signed-in user
  // never sees the sign-in screen flash.
  if (loading) return <Loading />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
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
