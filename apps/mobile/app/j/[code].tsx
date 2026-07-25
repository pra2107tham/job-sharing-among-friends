import { joinGroupByCode, previewGroupByCode, type GroupPreview } from '@jobdrop/api-client';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Body, Button, Loading, Screen, Title } from '@/components/ui';
import { supabase } from '@/lib/supabase';

/**
 * The invite landing page — https://jobdrop.app/j/<code> and jobdrop://j/<code>.
 *
 * A non-member cannot select the group directly, so the preview comes from a
 * SECURITY DEFINER RPC that deliberately exposes only the name and a member
 * count (0012_group_join_rpc.sql). Nothing about who is in it leaks before you
 * join.
 */
export default function JoinByCode() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();

  const [preview, setPreview] = useState<GroupPreview | null | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void previewGroupByCode(supabase, code)
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [code]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const groupId = await joinGroupByCode(supabase, code);
      router.replace(`/group/${groupId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join this group.');
    } finally {
      setBusy(false);
    }
  }

  if (preview === 'loading') return <Loading />;

  return (
    <>
      <Stack.Screen options={{ title: 'Join group', headerShown: true }} />
      <Screen>
        <View className="flex-1 justify-center gap-lg">
          {preview === null ? (
            <>
              <Title>This invite doesn&apos;t work</Title>
              <Body>
                The link may have been turned off or mistyped. Ask whoever sent it for a fresh one.
              </Body>
            </>
          ) : (
            <>
              <Title>{preview.name}</Title>
              <Body>
                {preview.member_count} member{preview.member_count === 1 ? '' : 's'}. Join to see
                the jobs they share, and yours will reach them.
              </Body>
            </>
          )}

          {error ? (
            <Text className="text-sm text-rejected" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
        </View>

        <View className="gap-md pb-xl">
          {preview !== null ? (
            <Button label="Join group" onPress={() => void join()} loading={busy} />
          ) : null}
          <Button label="Not now" variant="secondary" onPress={() => router.replace('/(tabs)')} />
        </View>
      </Screen>
    </>
  );
}
