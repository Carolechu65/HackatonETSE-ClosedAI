import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { PrimaryAction, Screen, ScreenHeader, Sheet, typography } from '../../src/ui/index.ts';
import { resolveTaskAccess, type TaskSession } from '../../src/features/tasks/access.ts';
import { DEMO_GROUP_ID, DEMO_MEMBER_NAMES, DEMO_MEMBERS, DEMO_TASKS } from '../../src/features/tasks/demo.ts';
import { createDemoTaskRepository } from '../../src/features/tasks/fakeRepository.ts';
import { TaskDetail } from '../../src/features/tasks/TaskDetail.tsx';
import type { HouseholdTask } from '../../src/features/tasks/model.ts';

/**
 * `/task/[taskId]` · ruta fina de P6 (`docs/ROUTES.md`).
 *
 * No contiene reglas de negocio: valida el parámetro, comprueba acceso y delega
 * en `TaskDetail` + `TaskRepository`. Abrir el enlace no completa ni acepta nada.
 *
 * DEMO: mientras P2 no entregue sesión real y P5 el repositorio, la ruta usa
 * fixtures etiquetados y un repositorio en memoria. `DEMO_SESSION` no es
 * autenticación: solo evita que la demo parezca una sesión real.
 */
const DEMO_SESSION: TaskSession = { userId: 'u-marta', groupIds: [DEMO_GROUP_ID] };

export default function TaskRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ taskId?: string | string[] }>();
  const taskId = Array.isArray(params.taskId) ? params.taskId[0] : params.taskId;

  const initial = DEMO_TASKS.find((task) => task.id === taskId) ?? null;
  const access = resolveTaskAccess(initial, DEMO_SESSION);

  const [repository] = useState(() => createDemoTaskRepository({
    groupId: DEMO_GROUP_ID,
    members: DEMO_MEMBERS,
    actorUid: 'u-marta',
    tasks: DEMO_TASKS,
    idFactory: () => 'demo-task-nueva',
  }));
  const [task, setTask] = useState<HouseholdTask | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (access === 'not_found' || task === null) {
    return <Redirect href="/+not-found" />;
  }

  if (access === 'sign_in_required') {
    return (
      <Screen scroll>
        <Stack.Screen options={{ title: 'Tarea' }} />
        <ScreenHeader eyebrow="LA PUERTA DE LA NEVERA" title="Entra primero" />
        <Sheet>
          <Text style={typography.detailTitle}>Esta nota es privada.</Text>
          <Text style={typography.body}>
            Para ver una tarea de tu grupo necesitas iniciar sesión. Abrir un enlace no da acceso.
          </Text>
        </Sheet>
        <PrimaryAction label="Ir al acceso" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  async function run(kind: 'complete' | 'cancel', current: HouseholdTask): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await repository.submit(kind === 'complete'
        ? {
          kind: 'completeTask',
          operationId: `demo-op-complete-${current.id}-${current.version}`,
          groupId: DEMO_GROUP_ID,
          taskId: current.id,
          expectedVersion: current.version,
          completedAtEpochMs: Date.now(),
        }
        : {
          kind: 'cancelTask',
          operationId: `demo-op-cancel-${current.id}-${current.version}`,
          groupId: DEMO_GROUP_ID,
          taskId: current.id,
          expectedVersion: current.version,
          cancelledAtEpochMs: Date.now(),
        });
      const next = repository.tasks.find((candidate) => candidate.id === current.id) ?? current;
      setTask(next);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'No se pudo guardar la tarea.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Tarea' }} />
      <TaskDetail
        task={task}
        assigneeName={task.assigneeUid === null ? null : DEMO_MEMBER_NAMES[task.assigneeUid] ?? null}
        nowEpochMs={Date.now()}
        timeZone="Europe/Madrid"
        busy={busy}
        error={error}
        demo
        write={{
          sync: 'CONFIRMED',
          alarmWithdrawal: task.status === 'pending' ? 'none' : 'pending',
        }}
        onComplete={() => void run('complete', task)}
        onCancel={() => void run('cancel', task)}
        onBack={() => router.back()}
      />
      <View style={{ height: 8 }} />
      <Text style={typography.support}>
        DEMO · sin sesión real ni repositorio conectado. Completar no programa ni cancela alarmas reales.
      </Text>
    </Screen>
  );
}
