import { useLocalSearchParams } from 'expo-router';
import { GroupScreen } from '../../../src/features/groups/GroupScreen.tsx';
export default function InviteRoute() { const {inviteId} = useLocalSearchParams<{inviteId:string}>(); return <GroupScreen invitation={inviteId} />; }
