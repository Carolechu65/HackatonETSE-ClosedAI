import { Stack } from 'expo-router';
import { AlarmRuntimeLabScreen } from '../src/features/alarms/AlarmRuntimeLabScreen';

export default function AlarmRuntimeRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Runtime de alarmas' }} />
      <AlarmRuntimeLabScreen />
    </>
  );
}
