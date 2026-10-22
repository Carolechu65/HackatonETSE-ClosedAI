import type { AlarmSummary } from '../domain/alarms';

export interface WidgetSnapshot {
  pendingProposals: number;
  pendingActivation: number;
  nextAlarm: Pick<AlarmSummary, 'id' | 'title' | 'scheduledAt'> | null;
}

/** Proyección pura. No instala ni actualiza ningún widget Android. */
export function buildWidgetSnapshot(
  alarms: readonly AlarmSummary[],
  nowEpochMs: number,
): WidgetSnapshot {
  const next = alarms
    .filter((alarm) => alarm.decision === 'accepted'
      && alarm.scheduling === 'scheduled'
      && alarm.scheduledAt !== null
      && Date.parse(alarm.scheduledAt) > nowEpochMs)
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!))[0];

  return {
    pendingProposals: alarms.filter((alarm) => alarm.decision === 'pending').length,
    pendingActivation: alarms.filter((alarm) => alarm.decision === 'accepted'
      && alarm.scheduling === 'pending_activation').length,
    nextAlarm: next ? { id: next.id, title: next.title, scheduledAt: next.scheduledAt } : null,
  };
}
