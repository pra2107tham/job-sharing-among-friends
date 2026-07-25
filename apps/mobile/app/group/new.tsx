import { createGroup } from '@jobdrop/api-client';
import { groupNameSchema } from '@jobdrop/contracts';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Body, Button, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function NewGroup() {
  const router = useRouter();
  const { session } = useSession();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    const parsed = groupNameSchema.safeParse(name);
    if (!parsed.success) return setError('Give the group a name.');
    if (!session) return setError('Your session expired. Sign in again.');

    setBusy(true);
    try {
      const group = await createGroup(supabase, parsed.data, session.user.id);
      // Straight to the invite screen: a group with one member is not useful,
      // and the next thing the user wants is the link to paste into WhatsApp.
      router.replace(`/group/${group.id}/invite`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the group.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'New group', headerShown: true }} />
      <Screen>
        <View className="flex-1 justify-center gap-lg">
          <View>
            <Title>Name the group</Title>
            <Body className="mt-sm">
              Something your friends will recognise — “2024 grads”, “backend crew”.
            </Body>
          </View>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Backend crew"
            autoFocus
            maxLength={60}
            returnKeyType="done"
            onSubmitEditing={() => void create()}
            className="h-[52px] rounded-md border border-ink100 px-md text-base text-ink900 dark:border-ink700 dark:text-ink50"
          />

          {error ? (
            <Text className="text-sm text-rejected" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
        </View>

        <View className="pb-xl">
          <Button label="Create group" onPress={() => void create()} loading={busy} />
        </View>
      </Screen>
    </>
  );
}
