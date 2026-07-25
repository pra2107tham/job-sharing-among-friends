import {
  getGroup,
  leaveGroup,
  listGroupMembers,
  type GroupMemberWithProfile,
} from '@jobdrop/api-client';
import type { GroupRow } from '@jobdrop/contracts';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import { Body, Button, Loading, Screen } from '@/components/ui';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function GroupSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useSession();

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [members, setMembers] = useState<GroupMemberWithProfile[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([getGroup(supabase, id), listGroupMembers(supabase, id)]).then(([g, m]) => {
      setGroup(g);
      setMembers(m);
    });
  }, [id]);

  function confirmLeave() {
    if (!session) return;
    Alert.alert(
      `Leave ${group?.name ?? 'this group'}?`,
      "You'll stop receiving jobs shared here, and your shares will stop reaching them.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            void leaveGroup(supabase, id, session.user.id)
              .then(() => router.replace('/(tabs)/groups'))
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }

  if (!group || !members) return <Loading />;

  return (
    <>
      <Stack.Screen options={{ title: group.name, headerShown: true }} />
      <Screen>
        <View className="py-lg">
          <Body>
            {members.length} member{members.length === 1 ? '' : 's'}
          </Body>
        </View>

        <FlatList
          data={members}
          keyExtractor={(m) => m.user_id}
          ItemSeparatorComponent={() => <View className="h-px bg-ink100 dark:bg-ink700" />}
          renderItem={({ item }) => (
            <View className="flex-row items-center justify-between py-md">
              <View>
                <Text className="text-base text-ink900 dark:text-ink50">
                  {item.profile?.display_name ?? 'Unnamed'}
                  {item.user_id === session?.user.id ? ' (you)' : ''}
                </Text>
                {item.profile?.handle ? (
                  <Text className="text-xs text-ink300">@{item.profile.handle}</Text>
                ) : null}
              </View>
              {item.role === 'admin' ? <Text className="text-xs text-ink300">admin</Text> : null}
            </View>
          )}
        />

        <View className="gap-md pb-xl">
          <Button
            label="Invite people"
            variant="secondary"
            onPress={() => router.push(`/group/${id}/invite`)}
          />
          <Button label="Leave group" variant="secondary" loading={busy} onPress={confirmLeave} />
        </View>
      </Screen>
    </>
  );
}
