import type { LocalOccurrence, OccurrenceKey } from '../../platform/alarms/index.ts';
import type { Task } from '../skeleton/model.ts';
import { reminderAt } from './taskTime.ts';

export const DEMO_USER_ID = 'demo-user';
export const DEMO_DEVICE_ID = 'demo-device';
export const DEMO_DEVICE_EPOCH = 1;

export function occurrenceKeyFor(task: Task, dueAt: Date): OccurrenceKey {
  return {
    userId: DEMO_USER_ID,
    requestId: `task:${task.id}`,
    occurrenceId: `task:${task.id}:${dueAt.toISOString()}`,
    deviceId: DEMO_DEVICE_ID,
    deviceEpoch: DEMO_DEVICE_EPOCH,
  };
}

export function occurrenceKeyFromTask(task: Task): OccurrenceKey | null {
  if (!task.dueAt) return null;
  const dueAt = new Date(task.dueAt);
  if (Number.isNaN(dueAt.getTime())) return null;
  return occurrenceKeyFor(task, dueAt);
}

function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid';
  } catch {
    return 'Europe/Madrid';
  }
}

/**
 * Construye la ocurrencia local a partir de una tarea.
 *
 * `dueAt` es la fecha límite de la tarea; el aviso se adelanta según la
 * prioridad. La identidad se mantiene estable para que reprogramar la misma
 * tarea actualice una sola alarma y cancelar apunte al mismo PendingIntent.
 */
export function buildTaskOccurrence(
  task: Task,
  dueAt: Date,
  mode: Task['alarmMode'] = task.alarmMode,
): LocalOccurrence {
  const reminder = reminderAt(dueAt, task.priority);
  return {
    ...occurrenceKeyFor(task, dueAt),
    requestVersion: 1,
    decisionRevision: 1,
    effectiveAtEpochMs: reminder.getTime(),
    timeZone: resolveTimeZone(),
    title: task.title,
    mode,
  };
}
