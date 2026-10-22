/**
 * P6 · Repositorio de tareas en memoria para la demo.
 *
 * **No es la implementación real.** Pierde los cambios al reiniciar, no envía
 * operaciones a Functions y no toca SQLite. Sirve para probar la UI y los estados
 * pendientes mientras P5 conecta el repositorio verdadero.
 */
import { DomainError } from '../../domain/errors.ts';
import type { OperationReceipt } from '../../domain/contracts/types.ts';
import { cancelTask, completeTask, reopenTask, createTask, type HouseholdTask, type TaskMember } from './model.ts';
import type { TaskCommand, TaskRepository } from './ports.ts';

export type DemoTaskRepository = TaskRepository & {
  readonly tasks: readonly HouseholdTask[];
  /** Fuerza el siguiente envío a fallar (queda como pendiente en la UI). */
  failNext(error?: DomainError): void;
};

export function createDemoTaskRepository(options: {
  readonly groupId: string;
  readonly members: readonly TaskMember[];
  readonly actorUid: string;
  readonly tasks?: readonly HouseholdTask[];
  readonly idFactory?: () => string;
}): DemoTaskRepository {
  let tasks: HouseholdTask[] = (options.tasks ?? []).map((task) => ({ ...task }));
  const listeners = new Set<(tasks: readonly HouseholdTask[]) => void>();
  const receipts = new Map<string, OperationReceipt>();
  const idFactory = options.idFactory ?? (() => `task-${tasks.length + 1}-demo`);
  let pendingFailure: DomainError | null = null;

  function notify(): void {
    const copy = tasks.map((task) => ({ ...task }));
    for (const listener of listeners) listener(copy);
  }

  function replace(next: HouseholdTask): void {
    tasks = tasks.map((task) => (task.id === next.id ? next : task));
  }

  return {
    get tasks() {
      return tasks.map((task) => ({ ...task }));
    },

    failNext(error = new DomainError('TEMPORARY_UNAVAILABLE', 'Sin conexión (demo).')) {
      pendingFailure = error;
    },

    subscribeTasks(groupId, onChange) {
      const listener = (next: readonly HouseholdTask[]) => {
        onChange(next.filter((task) => task.groupId === groupId));
      };
      listeners.add(listener);
      onChange(tasks.filter((task) => task.groupId === groupId));
      return () => {
        listeners.delete(listener);
      };
    },

    async submit(command: TaskCommand): Promise<OperationReceipt> {
      const replay = receipts.get(command.operationId);
      if (replay !== undefined) return replay;

      if (pendingFailure !== null) {
        const error = pendingFailure;
        pendingFailure = null;
        throw error;
      }

      const now = command.kind === 'createTask'
        ? Date.now()
        : command.kind === 'completeTask'
          ? command.completedAtEpochMs
          : command.kind === 'reopenTask' ? command.reopenedAtEpochMs : command.cancelledAtEpochMs;

      let affectedId: string | null = null;
      if (command.kind === 'createTask') {
        const id = idFactory();
        const created = createTask({
          id,
          groupId: command.groupId,
          createdByUid: options.actorUid,
          draft: command.draft,
          members: options.members,
        });
        tasks = [...tasks, created];
        affectedId = created.id;
      } else {
        const current = tasks.find((task) => task.id === command.taskId);
        if (current === undefined) {
          throw new DomainError('NOT_FOUND', 'La tarea no existe en este grupo.');
        }
        if (current.version !== command.expectedVersion) {
          throw new DomainError('VERSION_CONFLICT', 'La tarea cambió en otro dispositivo.', {
            expectedVersion: command.expectedVersion,
            currentVersion: current.version,
          });
        }
        const mutation = command.kind === 'completeTask'
          ? completeTask(current, { actorUid: options.actorUid, members: options.members, nowEpochMs: now })
          : command.kind === 'reopenTask'
            ? reopenTask(current, { actorUid: options.actorUid, members: options.members, nowEpochMs: now })
            : cancelTask(current, { actorUid: options.actorUid, members: options.members, nowEpochMs: now });
        if (mutation.changed) replace(mutation.task);
        affectedId = current.id;
      }

      const updated = affectedId === null ? undefined : tasks.find((task) => task.id === affectedId);
      const receipt: OperationReceipt = {
        operationId: command.operationId,
        status: 'APPLIED',
        serverTimeEpochMs: now,
        ...(updated === undefined ? {} : { result: { taskVersion: updated.version } }),
      };
      receipts.set(command.operationId, receipt);
      notify();
      return receipt;
    },
  };
}
