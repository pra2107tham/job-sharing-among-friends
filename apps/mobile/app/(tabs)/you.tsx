import { useState } from 'react';
import { Text, View } from 'react-native';
import { Body, Button, Screen, Title } from '@/components/ui';
import { signOut } from '@/lib/auth';
import { useSession } from '@/lib/session';

export default function You() {
  const { profile, session } = useSession();
  const [busy, setBusy] = useState(false);

  return (
    <Screen>
      <View className="pt-md pb-xl">
        <Title>You</Title>
      </View>

      <View className="gap-xs">
        <Text className="text-lg font-semibold text-ink900 dark:text-ink50">
          {profile?.display_name ?? 'Unnamed'}
        </Text>
        <Body>{profile?.handle ? `@${profile.handle}` : 'No handle set'}</Body>
        <Body className="text-xs">{session?.user.email ?? ''}</Body>
      </View>

      <View className="flex-1" />

      <View className="pb-xl">
        <Button
          label="Sign out"
          variant="secondary"
          loading={busy}
          onPress={() => {
            setBusy(true);
            // The gate redirects on the resulting auth state change.
            void signOut().finally(() => setBusy(false));
          }}
        />
      </View>
    </Screen>
  );
}
