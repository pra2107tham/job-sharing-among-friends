import { FEED_PAGE_SIZE, listFeed, subscribeToJobUpdates } from '@jobdrop/api-client';
import type { FeedItemRow } from '@jobdrop/contracts';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { JobCard } from '@/components/JobCard';
import { Button, EmptyState, Loading, Screen, Title } from '@/components/ui';
import { subscribeToOutbox } from '@/lib/outbox';
import { supabase } from '@/lib/supabase';

/**
 * The unified feed (doc 1 §5.2).
 *
 * One card per job across every group, because most people are in several
 * overlapping groups and a per-group inbox would make them visit each one. The
 * collapsing happens in SQL (feed_items, 0015_feed.sql) so pagination stays
 * correct.
 */
export default function Feed() {
  const router = useRouter();
  const [items, setItems] = useState<FeedItemRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pending, setPending] = useState(0);
  const exhausted = useRef(false);

  const load = useCallback(async () => {
    const rows = await listFeed(supabase);
    setItems(rows);
    exhausted.current = rows.length < FEED_PAGE_SIZE;
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load().catch(() => setItems([]));
    }, [load]),
  );

  // Queued-but-undelivered shares are surfaced honestly rather than hidden.
  useEffect(() => subscribeToOutbox((entries) => setPending(entries.length)), []);

  // Cards upgrade in place as enrichment lands.
  useEffect(() => {
    const channel = subscribeToJobUpdates(supabase, () => {
      void load().catch(() => {});
    });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  async function loadOlder() {
    if (loadingMore || exhausted.current || !items?.length) return;
    setLoadingMore(true);
    try {
      const oldest = items[items.length - 1];
      const older = await listFeed(supabase, { before: oldest?.last_shared_at });
      if (older.length < FEED_PAGE_SIZE) exhausted.current = true;
      setItems((prev) => (prev ? [...prev, ...older] : older));
    } finally {
      setLoadingMore(false);
    }
  }

  if (items === null) return <Loading />;

  return (
    <Screen>
      <View className="flex-row items-center justify-between pt-md pb-lg">
        <Title>Feed</Title>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share a job"
          hitSlop={12}
          onPress={() => router.push('/share')}
        >
          <Ionicons name="add-circle-outline" size={28} color="#2A7D62" />
        </Pressable>
      </View>

      {pending > 0 ? (
        <View className="mb-md rounded-md bg-ink50 px-md py-sm dark:bg-ink700">
          <Text className="text-xs text-ink500 dark:text-ink300">
            {pending} share{pending === 1 ? '' : 's'} waiting to send
          </Text>
        </View>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title="Nothing shared yet"
          hint="Jobs your friends drop into any of your groups land here, newest first."
          action={<Button label="Share a job" onPress={() => router.push('/share')} />}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.job_post_id}
          contentContainerClassName="gap-md pb-xl"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load().finally(() => setRefreshing(false));
              }}
            />
          }
          onEndReached={() => void loadOlder()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator className="my-md" /> : null}
          renderItem={({ item }) => (
            <JobCard
              job={item}
              meta={item}
              note={item.note}
              timestamp={item.last_shared_at}
              onPress={() => router.push(`/job/${item.job_post_id}`)}
            />
          )}
        />
      )}
    </Screen>
  );
}
