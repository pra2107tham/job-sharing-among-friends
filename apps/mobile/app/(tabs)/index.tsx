import { View } from 'react-native';
import { EmptyState, Screen, Title } from '@/components/ui';

export default function Feed() {
  return (
    <Screen>
      <View className="pt-md">
        <Title>Feed</Title>
      </View>
      <EmptyState
        title="Nothing shared yet"
        hint="Jobs your friends drop into any of your groups land here, newest first. Join a group to get started."
      />
    </Screen>
  );
}
