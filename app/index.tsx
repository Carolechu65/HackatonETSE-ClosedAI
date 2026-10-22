import { Stack } from 'expo-router';
import { AlarmInboxScreen } from '../src/features/alarms/AlarmInboxScreen';

export default function HomeRoute() {
  return <><Stack.Screen options={{ title: 'alarmaT' }} /><AlarmInboxScreen /></>;
}
