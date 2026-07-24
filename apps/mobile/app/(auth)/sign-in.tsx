import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Body, Button, Screen, Title } from '@/components/ui';
import { isAppleSignInAvailable, signInWithApple, signInWithGoogle } from '@/lib/auth';

export default function SignIn() {
  const [busy, setBusy] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    void isAppleSignInAvailable().then(setAppleAvailable);
  }, []);

  async function run(provider: 'google' | 'apple') {
    setError(null);
    setBusy(provider);
    try {
      await (provider === 'google' ? signInWithGoogle() : signInWithApple());
      // No navigation here: the gate in app/_layout.tsx reacts to the session.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <View className="flex-1 justify-center">
        <Title>Jobs your friends found.</Title>
        <Body className="mt-sm">
          Drop a link once, everyone in your groups gets it. No more forwarding the same job eight
          times.
        </Body>
      </View>

      <View className="gap-md pb-xl">
        {error ? (
          <Text className="text-sm text-rejected" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <Button
          label="Continue with Google"
          onPress={() => void run('google')}
          loading={busy === 'google'}
          disabled={busy !== null}
        />
        {appleAvailable ? (
          <Button
            label="Continue with Apple"
            variant="secondary"
            onPress={() => void run('apple')}
            loading={busy === 'apple'}
            disabled={busy !== null}
          />
        ) : null}
      </View>
    </Screen>
  );
}
