import { Link, Stack } from 'expo-router';
import { AlarmInboxScreen } from '../src/features/alarms/AlarmInboxScreen';

export default function HomeRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'alarmaT',
          headerRight: () => (
            <Link href="/alarm-runtime" style={{ color: '#145a50', fontWeight: '700' }}>
              Alarma real
            </Link>
          ),
        }}
      />
      <AlarmInboxScreen />
    </>
  );
}
