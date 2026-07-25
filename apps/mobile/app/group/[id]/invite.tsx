import { getGroup, inviteUrl } from '@jobdrop/api-client';
import type { GroupRow } from '@jobdrop/contracts';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Share, Text, View } from 'react-native';
import { Body, Button, Loading, Screen, Title } from '@/components/ui';
import { supabase } from '@/lib/supabase';

/**
 * Doc 1 §10: the invite link is the on-ramp, and it has to be one tap to get it
 * into WhatsApp. The OS share sheet is that tap.
 */
export default function Invite() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [group, setGroup] = useState<GroupRow | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void getGroup(supabase, id).then(setGroup);
  }, [id]);

  if (!group) return <Loading />;

  const link = inviteUrl(group.join_code);

  return (
    <>
      <Stack.Screen options={{ title: 'Invite', headerShown: true }} />
      <Screen>
        <View className="flex-1 justify-center gap-lg">
          <View>
            <Title>Invite your friends</Title>
            <Body className="mt-sm">
              Anyone with this link can join {group.name}. Jobs they share will reach everyone in
              the group.
            </Body>
          </View>

          <View className="rounded-lg border border-ink100 bg-ink50 p-lg dark:border-ink700 dark:bg-ink700">
            <Text className="text-xs uppercase text-ink300">Invite link</Text>
            <Text
              className="mt-xs text-base text-ink900 dark:text-ink50"
              selectable
              numberOfLines={2}
            >
              {link}
            </Text>
          </View>
        </View>

        <View className="gap-md pb-xl">
          <Button
            label="Share link"
            onPress={() => {
              void Share.share({
                message: `Join ${group.name} on JobDrop — we share job openings there: ${link}`,
              });
            }}
          />
          <Button
            label={copied ? 'Copied' : 'Copy link'}
            variant="secondary"
            onPress={() => {
              void Clipboard.setStringAsync(link).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          />
          <Button
            label="Open group"
            variant="secondary"
            onPress={() => router.replace(`/group/${group.id}`)}
          />
        </View>
      </Screen>
    </>
  );
}
