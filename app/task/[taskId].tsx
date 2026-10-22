import { useLocalSearchParams } from 'expo-router';
import { TaskProductDetail } from '../../src/features/tasks/TasksScreen.tsx';
export default function TaskRoute() { const {taskId} = useLocalSearchParams<{taskId:string}>(); return <TaskProductDetail taskId={taskId ?? ''} />; }
