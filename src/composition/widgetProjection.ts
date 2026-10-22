import type { PersistedWidgetSnapshot } from '../data/repositories/alarmRepository.ts';
import { buildWidgetSnapshot, isValidWidgetSnapshot, WIDGET_SNAPSHOT_SCHEMA_VERSION, type WidgetSnapshot } from '../widgets/snapshot.ts';

import type { HouseholdTask } from '../features/tasks/model.ts';
import type { Member } from './product.ts';

export type WidgetTaskContext = {
  userId: string; groupId: string; generatedAtEpochMs: number; timeZone: string;
  tasks: readonly HouseholdTask[]; members: readonly Member[];
};
export type WidgetTaskProjection = {
  snapshot: WidgetSnapshot;
  timeZone: string;
};

/** Cache only the bounded launcher projection, never the full household records. */
export function projectWidgetTasks(context: WidgetTaskContext): WidgetTaskProjection {
  return {
    timeZone: context.timeZone,
    snapshot: buildWidgetSnapshot({ alarms: [], nowEpochMs: context.generatedAtEpochMs,
      scope: { userId: context.userId, groupId: context.groupId },
      tasks: context.tasks.map(task => ({ ...task,
        assigneeLabel: task.assigneeUid === context.userId ? 'Tú' : task.assigneeUid === null ? 'Sin asignar'
          : context.members.find(member => member.userId === task.assigneeUid)?.displayName ?? 'Miembro del piso',
      })),
    }),
  };
}

export function isValidWidgetTaskProjection(value: unknown): value is WidgetTaskProjection {
  if (!value || typeof value !== 'object') return false;
  const projection = value as WidgetTaskProjection;
  if (!isValidWidgetSnapshot(projection.snapshot) || !projection.snapshot.scope || typeof projection.timeZone !== 'string') return false;
  try { new Intl.DateTimeFormat('es-ES', { timeZone: projection.timeZone }); return true; } catch { return false; }
}

/** A selected empty household must never fall back to another household's alarms. */
export function projectSelectedWidget(snapshot: PersistedWidgetSnapshot, selectedGroupId: string | null, taskProjection?: WidgetTaskProjection | null): WidgetSnapshot | null {
  const group = selectedGroupId ? snapshot.groups.find(item => item.groupId === selectedGroupId) : snapshot.groups[0];
  const groupId = selectedGroupId ?? group?.groupId;
  if (!groupId) return null;
  const taskSnapshot = taskProjection && isValidWidgetTaskProjection(taskProjection)
    && taskProjection.snapshot.scope?.userId === snapshot.userId && taskProjection.snapshot.scope.groupId === groupId
    ? taskProjection.snapshot : null;
  return {
    schemaVersion: WIDGET_SNAPSHOT_SCHEMA_VERSION,
    scope: { userId: snapshot.userId, groupId },
    // Publishing an offline cache again must not make its last sync appear fresh.
    generatedAtEpochMs: taskSnapshot
      ? group ? Math.min(snapshot.lastSyncedAtEpochMs ?? 0, taskSnapshot.generatedAtEpochMs) : taskSnapshot.generatedAtEpochMs
      : snapshot.lastSyncedAtEpochMs ?? 0,
    tasks: taskSnapshot?.tasks ?? [],
    pendingTaskCount: taskSnapshot?.pendingTaskCount ?? 0,
    nextAlarm: group?.nextAlarm ? {
      requestId: group.nextAlarm.requestId, occurrenceId: group.nextAlarm.occurrenceId,
      title: group.nextAlarm.title, scheduledAtEpochMs: group.nextAlarm.effectiveAtEpochMs,
      mode: group.nextAlarm.mode,
    } : null,
    counts: { pendingProposals: group?.pendingProposals ?? 0, pendingActivations: group?.pendingActivation ?? 0, withdrawalPending: group?.cancelPending ?? 0 },
  };
}
