import type { AlarmSummary } from '../domain/alarms';

/** Fixture de UI: no representa recepción, autorización ni programación real. */
export const demoAlarm: AlarmSummary = {
  id: 'demo-alarm-1',
  title: 'Sacar la basura',
  proposedBy: 'Ana · demo',
  scheduledAt: null,
  decision: 'pending',
  scheduling: 'not_scheduled',
};

export interface DemoAlarmRepository {
  list(): Promise<readonly AlarmSummary[]>;
  subscribeInbox(onChange: (items: readonly AlarmSummary[]) => void): () => void;
  respond(id: string, decision: 'accepted' | 'rejected'): Promise<AlarmSummary>;
}

/** Solo memoria; al reiniciar se pierden las decisiones. P5 sustituye este adaptador. */
export function createDemoAlarmRepository(
  initial: readonly AlarmSummary[] = [demoAlarm],
): DemoAlarmRepository {
  let items = initial.map((item) => ({ ...item }));
  const listeners = new Set<(items: readonly AlarmSummary[]) => void>();
  const snapshot = () => items.map((item) => ({ ...item }));

  return {
    async list() {
      return snapshot();
    },
    subscribeInbox(onChange) {
      listeners.add(onChange);
      onChange(snapshot());
      return () => { listeners.delete(onChange); };
    },
    async respond(id, decision) {
      const item = items.find((candidate) => candidate.id === id);
      if (!item) throw new Error('No existe la alarma de demostración.');
      const updated: AlarmSummary = {
        ...item,
        decision,
        scheduling: decision === 'accepted' ? 'pending_activation' : 'not_scheduled',
      };
      items = items.map((candidate) => candidate.id === id ? updated : candidate);
      for (const listener of listeners) listener(snapshot());
      return { ...updated };
    },
  };
}
