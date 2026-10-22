import { useLocalSearchParams } from 'expo-router';
import { MemberScreen } from '../../../src/features/groups/MemberScreen.tsx';

export default function MemberRoute() {
  const { userId, groupId } = useLocalSearchParams<{ userId: string; groupId: string }>();
  return <MemberScreen userId={userId ?? ''} groupId={groupId ?? ''} />;
}
