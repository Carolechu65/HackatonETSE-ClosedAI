import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Sheet, typography } from '../../ui/index.ts';
import { DEMO_GROUP_ID, DEMO_MEMBER_NAMES, DEMO_MEMBERS, DEMO_TASKS, demoMemberName } from './demo.ts';
import { createDemoTaskRepository } from './fakeRepository.ts';
import { TaskCard } from './TaskCard.tsx';

const DEMO_NOW = Date.parse('2026-10-22T09:00:00.000Z');
const DEMO_TZ = 'Europe/Madrid';

/**
 * Vista de demostración del tablero de tareas.
 *
 * Sustituible por P2/P5: recibe datos y acciones de un `TaskRepository`; hoy usa
 * el fake en memoria y lo dice. No escribe en Firestore ni programa alarmas.
 */
export function TaskPreview() {
  const [repository] = useState(() => createDemoTaskRepository({
    groupId: DEMO_GROUP_ID,
    members: DEMO_MEMBERS,
    actorUid: 'u-marta',
    tasks: DEMO_TASKS,
    idFactory: () => `demo-task-${DEMO_TASKS.length + 1}`,
  }));
  const [tasks, setTasks] = useState(() => repository.tasks);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => repository.subscribeTasks(DEMO_GROUP_ID, (next) => setTasks([...next])), [repository]);

  async function complete(taskId: string): Promise<void> {
    const current = tasks.find((task) => task.id === taskId);
    if (current === undefined) return;
    setBusy(true);
    setError(null);
    try {
      await repository.submit({
        kind: 'completeTask',
        operationId: `demo-op-complete-${taskId}-${current.version}`,
        groupId: DEMO_GROUP_ID,
        taskId,
        expectedVersion: current.version,
        completedAtEpochMs: DEMO_NOW,
      });
    } catch {
      setError('No se pudo completar en la demo. Revisa el estado antes de repetir.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.page}>
      <Sheet>
        <Text style={typography.labelOnNote}>TAREAS · DEMO EN MEMORIA</Text>
        <Text style={typography.detailTitle}>Lo que hay que hacer</Text>
        <Text style={typography.support}>
          Datos de ejemplo. No se guardan, no envían operaciones y no programan alarmas.
          Toca una tarea pendiente para completarla en la demo: verás cómo la retirada
          de alarmas queda pendiente hasta el acuse del móvil.
        </Text>
      </Sheet>

      {error === null ? null : (
        <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      )}

      {tasks.map((task, index) => (
        <TaskCard
          key={task.id}
          task={task}
          index={index}
          nowEpochMs={DEMO_NOW}
          timeZone={DEMO_TZ}
          assigneeName={task.assigneeUid === null ? null : demoMemberName(task.assigneeUid)}
          write={{
            sync: 'CONFIRMED',
            alarmWithdrawal: task.status === 'pending' ? 'none' : 'pending',
          }}
          demo
          onPress={task.status === 'pending' && !busy ? () => void complete(task.id) : undefined}
        />
      ))}

      <Text style={typography.support}>
        Responsables demo: {DEMO_MEMBERS.map((member) => DEMO_MEMBER_NAMES[member.uid] ?? member.uid).join(' · ')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  error: { ...typography.support, color: '#8c2b22' },
});
