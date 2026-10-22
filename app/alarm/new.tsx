import { useLocalSearchParams } from 'expo-router';
import { AlarmCreateScreen } from '../../src/features/alarms/AlarmCreateScreen.tsx';

export default function NewAlarmRoute() {
  const { taskId } = useLocalSearchParams<{ taskId?: string | string[] }>();
  const initialTaskId = Array.isArray(taskId) ? taskId[0] : taskId;
  return <AlarmCreateScreen key={initialTaskId ?? 'independent'} initialTaskId={initialTaskId} />;
}
