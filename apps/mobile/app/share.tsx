import { listGroupOverview } from '@jobdrop/api-client';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import { Body, Button, Screen, Title } from '@/components/ui';
import { queueShare } from '@/lib/share';
import { supabase } from '@/lib/supabase';

/**
 * The in-app share composer.
 *
 * This is the M2 stand-in for the Android bubble and the iOS Share Extension
 * (M3) — the same `queueShare` path, reached by opening the app instead of by a
 * gesture. Everything about it is built around doc 1 §4.3: the send is
 * confirmed the instant it is durably queued, never when the network replies.
 */
export default function ShareComposer() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [groupCount, setGroupCount] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listGroupOverview(supabase).then((g) => setGroupCount(g.length));
  }, []);

  // Offer the clipboard as a one-tap fill. On iOS reading the clipboard shows a
  // permission banner, so it is a button the user presses rather than an
  // automatic read on focus.
  async function pasteFromClipboard() {
    const clip = await Clipboard.getStringAsync();
    if (clip.trim()) setText(clip.trim());
  }

  async function send() {
    const raw = text.trim();
    if (!raw) return;

    setError(null);
    try {
      await queueShare(raw, note.trim() || null);
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setSent(true);
      // Confirm, then get out of the way. The share is already durable.
      setTimeout(() => router.back(), 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not queue that share.');
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Share a job', headerShown: true }} />
      <Screen>
        <View className="flex-1 gap-lg pt-lg">
          <View>
            <Title>Share a job</Title>
            <Body className="mt-sm">
              {groupCount === null
                ? ' '
                : groupCount === 0
                  ? "You're not in any groups yet — join or create one first."
                  : `Goes to all ${groupCount} of your group${groupCount === 1 ? '' : 's'} at once.`}
            </Body>
          </View>

          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Paste a link, or the whole job description"
            multiline
            autoFocus
            textAlignVertical="top"
            className="min-h-[140px] rounded-lg border border-ink100 p-md text-base text-ink900 dark:border-ink700 dark:text-ink50"
          />

          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Add a note (optional) — “this one's remote”"
            maxLength={500}
            className="h-[52px] rounded-md border border-ink100 px-md text-base text-ink900 dark:border-ink700 dark:text-ink50"
          />

          {error ? (
            <Text className="text-sm text-rejected" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
        </View>

        <View className="gap-md pb-xl">
          <Button
            label={sent ? 'Sent ✓' : 'Send to all my groups'}
            onPress={() => void send()}
            disabled={!text.trim() || sent || groupCount === 0}
          />
          <Button
            label="Paste from clipboard"
            variant="secondary"
            onPress={() => void pasteFromClipboard()}
          />
        </View>
      </Screen>
    </>
  );
}
