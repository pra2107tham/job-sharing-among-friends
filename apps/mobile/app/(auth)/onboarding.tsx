import { completeOnboarding } from '@jobdrop/api-client';
import { displayNameSchema, handleSchema } from '@jobdrop/contracts';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Body, Button, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

/**
 * Step 2 of doc 1 §10. Deliberately one screen with two fields — the next step
 * (join or create a group) is what actually matters, and every field here is a
 * field between the user and a working app.
 */
export default function Onboarding() {
  const { session, profile, refreshProfile } = useSession();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [handle, setHandle] = useState(profile?.handle ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);

    const name = displayNameSchema.safeParse(displayName);
    if (!name.success) return setError('Add your name so friends recognise you.');

    const parsedHandle = handleSchema.safeParse(handle);
    if (!parsedHandle.success) {
      return setError(parsedHandle.error.issues[0]?.message ?? 'That handle will not work.');
    }

    if (!session) return setError('Your session expired. Sign in again.');

    setBusy(true);
    try {
      await completeOnboarding(supabase, session.user.id, {
        display_name: name.data,
        handle: parsedHandle.data,
      });
      await refreshProfile();
    } catch (err) {
      // 23505 is a unique violation — the only user-actionable failure here.
      const code = (err as { code?: string }).code;
      setError(
        code === '23505'
          ? 'That handle is taken. Try another.'
          : err instanceof Error
            ? err.message
            : 'Could not save. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View className="flex-1 justify-center gap-lg">
        <View>
          <Title>What should we call you?</Title>
          <Body className="mt-sm">Your friends will see this next to everything you share.</Body>
        </View>

        <View className="gap-sm">
          <Text className="text-sm font-medium text-ink500 dark:text-ink300">Name</Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Pratham Shirbhate"
            autoCapitalize="words"
            autoComplete="name"
            className="h-[52px] rounded-md border border-ink100 px-md text-base text-ink900 dark:border-ink700 dark:text-ink50"
          />
        </View>

        <View className="gap-sm">
          <Text className="text-sm font-medium text-ink500 dark:text-ink300">Handle</Text>
          <TextInput
            value={handle}
            onChangeText={(t) => setHandle(t.toLowerCase())}
            placeholder="pratham"
            autoCapitalize="none"
            autoCorrect={false}
            className="h-[52px] rounded-md border border-ink100 px-md text-base text-ink900 dark:border-ink700 dark:text-ink50"
          />
          <Text className="text-xs text-ink500 dark:text-ink300">
            3-20 lowercase letters, numbers or underscores.
          </Text>
        </View>

        {error ? (
          <Text className="text-sm text-rejected" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </View>

      <View className="pb-xl">
        <Button label="Continue" onPress={() => void save()} loading={busy} />
      </View>
    </Screen>
  );
}
