import {
  getGroup,
  getMessage,
  listGroupMessages,
  markGroupRead,
  MESSAGE_PAGE_SIZE,
  sendGroupMessage,
  subscribeToGroup,
  subscribeToJobUpdates,
} from '@jobdrop/api-client';
import type { GroupRow, MessageWithRelations } from '@jobdrop/contracts';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { JobCard, jobFromPost } from '@/components/JobCard';
import { EmptyState, Loading } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

/**
 * The group timeline.
 *
 * Inverted list: chat reads from the bottom, and an inverted FlatList keeps the
 * newest message pinned without measuring content height or scrolling on every
 * insert.
 */
export default function GroupChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useSession();

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [messages, setMessages] = useState<MessageWithRelations[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const exhausted = useRef(false);

  const load = useCallback(async () => {
    const [g, m] = await Promise.all([getGroup(supabase, id), listGroupMessages(supabase, id)]);
    setGroup(g);
    setMessages(m);
    exhausted.current = m.length < MESSAGE_PAGE_SIZE;
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Opening a group is what marks it read; doing it on unmount instead would
  // leave the badge stale for as long as the user sits in the chat.
  useEffect(() => {
    void markGroupRead(supabase, id).catch(() => {});
  }, [id, messages?.length]);

  useEffect(() => {
    const channel = subscribeToGroup(supabase, id, (messageId) => {
      void getMessage(supabase, messageId).then((incoming) => {
        if (!incoming) return;
        setMessages((prev) => {
          if (!prev) return prev;
          // Realtime can race the optimistic insert and the initial fetch.
          if (prev.some((m) => m.id === incoming.id)) return prev;
          return [incoming, ...prev];
        });
      });
    });

    // A card that arrived as a bare link upgrades in place once the unfurl
    // worker fills in the role and company (doc 1 §4.3).
    const jobChannel = subscribeToJobUpdates(supabase, (jobPostId) => {
      setMessages((prev) => {
        if (!prev?.some((m) => m.job_post_id === jobPostId)) return prev;
        void listGroupMessages(supabase, id).then(setMessages);
        return prev;
      });
    });

    return () => {
      void supabase.removeChannel(channel);
      void supabase.removeChannel(jobChannel);
    };
  }, [id]);

  async function send() {
    const body = draft.trim();
    if (!body || !session) return;

    setDraft('');
    setSending(true);
    try {
      const message = await sendGroupMessage(supabase, {
        groupId: id,
        senderId: session.user.id,
        body,
        clientMsgId: Crypto.randomUUID(),
      });
      setMessages((prev) =>
        prev && !prev.some((m) => m.id === message.id) ? [message, ...prev] : prev,
      );
    } catch {
      // Put the text back rather than losing what they typed.
      setDraft(body);
    } finally {
      setSending(false);
    }
  }

  async function loadOlder() {
    if (loadingMore || exhausted.current || !messages?.length) return;
    setLoadingMore(true);
    try {
      const oldest = messages[messages.length - 1];
      const older = await listGroupMessages(supabase, id, { before: oldest?.created_at });
      if (older.length < MESSAGE_PAGE_SIZE) exhausted.current = true;
      setMessages((prev) => (prev ? [...prev, ...older] : older));
    } finally {
      setLoadingMore(false);
    }
  }

  if (messages === null) return <Loading />;

  return (
    <>
      <Stack.Screen
        options={{
          title: group?.name ?? 'Group',
          headerShown: true,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Group settings"
              hitSlop={12}
              onPress={() => router.push(`/group/${id}/settings`)}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color="#615B54" />
            </Pressable>
          ),
        }}
      />

      <KeyboardAvoidingView
        className="flex-1 bg-white dark:bg-ink900"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}
      >
        {messages.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            hint="Drop a job link and it goes to everyone in this group — and every other group you're in."
          />
        ) : (
          <FlatList
            inverted
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerClassName="px-lg py-md gap-md"
            onEndReached={() => void loadOlder()}
            onEndReachedThreshold={0.4}
            ListFooterComponent={loadingMore ? <ActivityIndicator className="my-md" /> : null}
            renderItem={({ item }) => {
              const mine = item.sender_id === session?.user.id;

              if (item.kind === 'job' && item.job) {
                return (
                  <View className="gap-xs">
                    <Text className="text-xs text-ink300">
                      {mine ? 'You' : (item.sender?.display_name ?? 'Someone')} ·{' '}
                      {relativeTime(item.created_at)}
                    </Text>
                    <JobCard
                      job={jobFromPost(item.job)}
                      note={item.body}
                      onPress={() => router.push(`/job/${item.job_post_id}`)}
                    />
                  </View>
                );
              }

              return (
                <View className={mine ? 'items-end' : 'items-start'}>
                  {!mine ? (
                    <Text className="mb-xs text-xs text-ink300">
                      {item.sender?.display_name ?? 'Someone'}
                    </Text>
                  ) : null}
                  <View
                    className={`max-w-[80%] rounded-lg px-md py-sm ${
                      mine ? 'bg-accent500' : 'bg-ink50 dark:bg-ink700'
                    }`}
                  >
                    <Text className={mine ? 'text-white' : 'text-ink900 dark:text-ink50'}>
                      {item.body}
                    </Text>
                  </View>
                  <Text className="mt-xs text-xs text-ink300">{relativeTime(item.created_at)}</Text>
                </View>
              );
            }}
          />
        )}

        <View className="flex-row items-end gap-sm border-t border-ink100 px-lg py-md dark:border-ink700">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message or paste a job link"
            multiline
            className="max-h-[120px] flex-1 rounded-lg border border-ink100 px-md py-sm text-base text-ink900 dark:border-ink700 dark:text-ink50"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            disabled={!draft.trim() || sending}
            onPress={() => void send()}
            className={`h-[44px] w-[44px] items-center justify-center rounded-pill bg-accent500 ${
              !draft.trim() || sending ? 'opacity-40' : 'active:opacity-80'
            }`}
          >
            <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}
