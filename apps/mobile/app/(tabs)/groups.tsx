import { listMyGroups } from '@jobdrop/api-client';
import type { GroupRow } from '@jobdrop/contracts';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { Body, EmptyState, Loading, Screen, Title } from '@/components/ui';
import { supabase } from '@/lib/supabase';

/**
 * Reads real data even at M0, because it is the first proof that auth, RLS and
 * the client all line up. A user with no groups correctly sees an empty list
 * rather than an error — RLS filters, it does not reject.
 */
export default function Groups() {
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setGroups(await listMyGroups(supabase));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load groups.');
      setGroups([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (groups === null) return <Loading />;

  return (
    <Screen>
      <View className="pt-md pb-lg">
        <Title>Groups</Title>
        {error ? <Text className="mt-sm text-sm text-rejected">{error}</Text> : null}
      </View>

      {groups.length === 0 ? (
        <EmptyState
          title="No groups yet"
          hint="Create one for your job-hunting circle, or open an invite link a friend sent you."
        />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.id}
          ItemSeparatorComponent={() => <View className="h-px bg-ink100 dark:bg-ink700" />}
          renderItem={({ item }) => (
            <View className="py-lg">
              <Text className="text-base font-semibold text-ink900 dark:text-ink50">
                {item.name}
              </Text>
              <Body className="mt-xs">Tap to open — coming in M1</Body>
            </View>
          )}
        />
      )}
    </Screen>
  );
}
