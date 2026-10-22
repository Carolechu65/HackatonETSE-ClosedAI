import { StyleSheet, Text, View } from 'react-native';
import { Note, typography } from '../../ui/index.ts';
import type { HouseholdTask, TaskWriteState } from './model.ts';
import { TaskCard } from './TaskCard.tsx';

export type TaskListProps = {
  tasks: readonly HouseholdTask[];
  nowEpochMs: number;
  timeZone: string;
  resolveName?: (uid: string | null) => string;
  writeState?: (task: HouseholdTask) => TaskWriteState | undefined;
  onOpen?: (task: HouseholdTask) => void;
  /** Los fixtures de demo deben seguir etiquetados hasta conectar P5. */
  demo?: boolean;
};

/** Lista de tareas del grupo; vacía se explica, no se deja en blanco. */
export function TaskList({
  tasks,
  nowEpochMs,
  timeZone,
  resolveName,
  writeState,
  onOpen,
  demo = false,
}: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <Note index={0} label="TAREAS · GRUPO" title="Nada apuntado todavía">
        <Text style={typography.support}>
          Cuando alguien cree una tarea aparecerá aquí, con responsable y vencimiento.
        </Text>
      </Note>
    );
  }

  return (
    <View style={styles.list}>
      {tasks.map((task, index) => (
        <TaskCard
          key={task.id}
          task={task}
          index={index}
          nowEpochMs={nowEpochMs}
          timeZone={timeZone}
          assigneeName={resolveName?.(task.assigneeUid) ?? null}
          write={writeState?.(task)}
          onPress={onOpen === undefined ? undefined : () => onOpen(task)}
          demo={demo}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 16 },
});
