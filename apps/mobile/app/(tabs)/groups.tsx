import { listGroupOverview } from '@jobdrop/api-client';
import type { GroupOverviewRow } from '@jobdrop/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Body, Button, EmptyState, Loading, Screen, Title } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';

export default function Groups() {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupOverviewRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setGroups(await listGroupOverview(supabase));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load groups.');
      setGroups([]);
    }
  }, []);

  // Refetch on focus rather than only on mount: unread counts go stale the
  // moment the user reads a group and comes back.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (groups === null) return <Loading />;

  return (
    <Screen>
      <View className="flex-row items-center justify-between pt-md pb-lg">
        <Title>Groups</Title>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create a group"
          hitSlop={12}
          onPress={() => router.push('/group/new')}
        >
          <Ionicons name="add-circle-outline" size={28} color="#2A7D62" />
        </Pressable>
      </View>

      {error ? <Text className="mb-md text-sm text-rejected">{error}</Text> : null}

      {groups.length === 0 ? (
        <EmptyState
          title="No groups yet"
          hint="Make one for your job-hunting circle and send the invite link on WhatsApp. Everything you share goes to every group you're in."
          action={<Button label="Create a group" onPress={() => router.push('/group/new')} />}
        />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load().finally(() => setRefreshing(false));
              }}
            />
          }
          ItemSeparatorComponent={() => <View className="h-px bg-ink100 dark:bg-ink700" />}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              className="flex-row items-center gap-md py-lg active:opacity-70"
              onPress={() => router.push(`/group/${item.id}`)}
            >
              <View className="h-[44px] w-[44px] items-center justify-center rounded-pill bg-accent50 dark:bg-accent600">
                <Text className="text-base font-semibold text-accent600 dark:text-accent50">
                  {item.name.slice(0, 2).toUpperCase()}
                </Text>
              </View>

              <View className="flex-1">
                <View className="flex-row items-center justify-between">
                  <Text
                    className="flex-1 text-base font-semibold text-ink900 dark:text-ink50"
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <Text className="ml-sm text-xs text-ink300">
                    {relativeTime(item.last_message_at)}
                  </Text>
                </View>

                <View className="mt-xs flex-row items-center justify-between">
                  <Body className="flex-1 text-sm">
                    {item.last_message_preview
                      ? `${item.last_message_sender ? `${item.last_message_sender}: ` : ''}${item.last_message_preview}`
                      : `${item.member_count} member${item.member_count === 1 ? '' : 's'} · nothing shared yet`}
                  </Body>

                  {item.unread_count > 0 ? (
                    <View className="ml-sm min-w-[22px] items-center rounded-pill bg-accent500 px-sm py-xs">
                      <Text className="text-xs font-semibold text-white">{item.unread_count}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
