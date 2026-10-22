import type { PersistedWidgetSnapshot } from '../data/repositories/alarmRepository.ts';
import { WIDGET_SNAPSHOT_SCHEMA_VERSION, type WidgetSnapshot } from '../widgets/snapshot.ts';

/** A selected empty household must never fall back to another household's alarms. */
export function projectSelectedWidget(snapshot: PersistedWidgetSnapshot, selectedGroupId: string | null): WidgetSnapshot | null {
  const group = selectedGroupId ? snapshot.groups.find(item => item.groupId === selectedGroupId) : snapshot.groups[0];
  const groupId = selectedGroupId ?? group?.groupId;
  if (!groupId) return null;
  return {
    schemaVersion: WIDGET_SNAPSHOT_SCHEMA_VERSION,
    scope: { userId: snapshot.userId, groupId },
    // Publishing an offline cache again must not make its last sync appear fresh.
    generatedAtEpochMs: snapshot.lastSyncedAtEpochMs ?? 0,
    nextAlarm: group?.nextAlarm ? {
      requestId: group.nextAlarm.requestId, occurrenceId: group.nextAlarm.occurrenceId,
      title: group.nextAlarm.title, scheduledAtEpochMs: group.nextAlarm.effectiveAtEpochMs,
      mode: group.nextAlarm.mode,
    } : null,
    counts: { pendingProposals: group?.pendingProposals ?? 0, pendingActivations: group?.pendingActivation ?? 0, withdrawalPending: group?.cancelPending ?? 0 },
  };
}
