import { View } from 'react-native';
import { EmptyState, Screen, Title } from '@/components/ui';

export default function Tracker() {
  return (
    <Screen>
      <View className="pt-md">
        <Title>Tracker</Title>
      </View>
      <EmptyState
        title="Nothing to track yet"
        hint="Mark a job as saved or applied and it shows up here, with the apply link and HR email kept alongside it. Only you can see this."
      />
    </Screen>
  );
}
