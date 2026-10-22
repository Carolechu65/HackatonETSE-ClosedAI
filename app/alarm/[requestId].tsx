import { useLocalSearchParams } from 'expo-router';
import { AlarmDetailScreen } from '../../src/features/alarms/AlarmDetailScreen.tsx';
export default function AlarmRoute() { const {requestId} = useLocalSearchParams<{requestId:string}>(); return <AlarmDetailScreen requestId={requestId ?? ''} />; }
