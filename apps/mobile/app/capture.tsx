import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, Text, View } from 'react-native';
import {
  canDrawOverlay,
  isBubbleRunning,
  isNativeShareAvailable,
  requestOverlayPermission,
  startBubble,
  stopBubble,
  supportsBubble,
} from '../modules/jobdrop-share';
import { Body, Button, Screen, Title } from '@/components/ui';

/**
 * Capture setup (doc 1 §10, step 4).
 *
 * This screen exists because the bubble needs a permission that has no runtime
 * dialog — the user has to visit a settings page and come back. Anything that
 * indirect needs to explain itself first, or people bounce off it.
 *
 * It is also where the platform difference gets stated plainly rather than
 * hidden. Android users get the bubble; iOS users cannot, ever, and being
 * straight about that is better than leaving them hunting for a switch that
 * does not exist.
 */

function Row({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return (
    <View className="flex-row gap-md">
      <View className="mt-xs h-[28px] w-[28px] items-center justify-center rounded-pill bg-accent50 dark:bg-accent600">
        <Ionicons name={icon as never} size={15} color="#2A7D62" />
      </View>
      <View className="flex-1">
        <Text className="text-base font-semibold text-ink900 dark:text-ink50">{title}</Text>
        <Text className="mt-xs text-sm text-ink500 dark:text-ink300">{detail}</Text>
      </View>
    </View>
  );
}

export default function CaptureSetup() {
  const [granted, setGranted] = useState(false);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(() => {
    setGranted(canDrawOverlay());
    setRunning(isBubbleRunning());
  }, []);

  useEffect(() => {
    refresh();
    // The grant happens in the Settings app, so the only reliable moment to
    // re-check is when we come back to the foreground.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return (
    <>
      <Stack.Screen options={{ title: 'Quick sharing', headerShown: true }} />
      <Screen>
        <View className="flex-1 gap-xl pt-lg">
          <View>
            <Title>Share without opening the app</Title>
            <Body className="mt-sm">
              The whole point is that sending a job takes one gesture from wherever you found it.
            </Body>
          </View>

          {Platform.OS === 'android' ? (
            <View className="gap-lg">
              <Row
                icon="magnet-outline"
                title="Drag a link onto the bubble"
                detail="Long-press a link in any app and drag it onto the floating JobDrop circle. It sends to every group you're in."
              />
              <Row
                icon="clipboard-outline"
                title="Or tap it"
                detail="Tap the bubble to send whatever you last copied. Android sometimes blocks apps from reading the clipboard — if that happens, JobDrop opens instead of failing silently."
              />
              <Row
                icon="share-social-outline"
                title="Or use the share sheet"
                detail="JobDrop appears in Android's Share menu everywhere. This always works, bubble or not."
              />
            </View>
          ) : (
            <View className="gap-lg">
              <Row
                icon="share-outline"
                title="Share → JobDrop"
                detail="From any app, tap Share and pick JobDrop. It sends immediately — the sheet is just a confirmation, with an Undo if you misfired."
              />
              <Row
                icon="information-circle-outline"
                title="No floating bubble on iPhone"
                detail="iOS does not let any app draw over other apps, so the bubble is Android-only. The share sheet is the closest iOS gets, and it is two taps."
              />
            </View>
          )}

          {!isNativeShareAvailable ? (
            <View className="rounded-md bg-ink50 px-md py-sm dark:bg-ink700">
              <Text className="text-xs text-ink500 dark:text-ink300">
                These need a development build — they involve native code, so they can&apos;t work
                in Expo Go or the web app.
              </Text>
            </View>
          ) : null}
        </View>

        <View className="gap-md pb-xl">
          {supportsBubble && !granted ? (
            <>
              <Body className="text-sm">
                Android asks for “Display over other apps” on a settings screen. Grant it, then come
                back here.
              </Body>
              <Button label="Open settings" onPress={() => requestOverlayPermission()} />
            </>
          ) : null}

          {supportsBubble && granted ? (
            <Button
              label={running ? 'Turn off bubble' : 'Turn on bubble'}
              onPress={() => {
                if (running) {
                  stopBubble();
                } else {
                  startBubble();
                }
                // The service takes a moment to come up or go down.
                setTimeout(refresh, 400);
              }}
            />
          ) : null}

          {Platform.OS === 'ios' && isNativeShareAvailable ? (
            <Button
              label="Try it in Safari"
              variant="secondary"
              onPress={() => void Linking.openURL('https://boards.greenhouse.io')}
            />
          ) : null}
        </View>
      </Screen>
    </>
  );
}
