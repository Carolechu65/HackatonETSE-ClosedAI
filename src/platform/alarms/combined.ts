import type { AlarmRuntime, LocalOccurrence, OccurrenceKey } from './index.ts';
import { createAlarmRuntime } from './index.ts';
import { createNotificationRuntime } from '../notifications/native.ts';

const sameKey = (a: OccurrenceKey, b: OccurrenceKey) => a.userId === b.userId && a.requestId === b.requestId && a.occurrenceId === b.occurrenceId && a.deviceId === b.deviceId && a.deviceEpoch === b.deviceEpoch;

/** Single P5 port, with a distinct real mechanism for each accepted modality. */
export function createCombinedAlarmRuntime(native: AlarmRuntime = createAlarmRuntime(), reminders: AlarmRuntime = createNotificationRuntime()): AlarmRuntime {
  let pending: Promise<unknown> = Promise.resolve();
  function serial<T>(f: () => Promise<T>): Promise<T> { const result = pending.then(f, f); pending = result.catch(() => {}); return result; }
  async function snapshots() { return Promise.all([native.getSnapshot(), reminders.getSnapshot()]); }
  return {
    schedule: (spec: LocalOccurrence) => serial(async () => {
      const states = await snapshots();
      const all = states.flatMap(s => s.occurrences);
      const sameRequest = all.filter(r => r.spec.userId === spec.userId && r.spec.deviceId === spec.deviceId && r.spec.requestId === spec.requestId);
      if (sameRequest.some(r => r.spec.requestVersion > spec.requestVersion || r.spec.decisionRevision > spec.decisionRevision)) return { status: 'FAILED', reason: 'STALE_VERSION' };
      if (sameRequest.some(r => sameKey(r.spec, spec) && r.status === 'CANCELLED' && (spec.requestVersion < r.spec.requestVersion || spec.decisionRevision <= r.spec.decisionRevision))) return { status: 'FAILED', reason: 'CANCELLED_OCCURRENCE' };
      const target = spec.mode === 'ALARM' ? native : reminders;
      const other = spec.mode === 'ALARM' ? reminders : native;
      const otherState = states[spec.mode === 'ALARM' ? 1 : 0]!;
      for (const old of otherState.occurrences.filter(r => sameKey(r.spec, spec) && ['SCHEDULED', 'SCHEDULING', 'FIRED'].includes(r.status))) {
        if (old.spec.requestVersion === spec.requestVersion && old.spec.decisionRevision === spec.decisionRevision) return { status: 'FAILED', reason: 'VERSION_PAYLOAD_CONFLICT' };
        if ((await other.cancel(old.spec)).status !== 'CANCELLED') return { status: 'FAILED', reason: 'PREVIOUS_MODE_CANCEL_PENDING' };
      }
      return target.schedule(spec);
    }),
    cancel: key => serial(async () => {
      const states = await snapshots();
      const owners = [native, reminders].filter((_, i) => states[i]!.occurrences.some(r => sameKey(r.spec, key)));
      // Unknown identity: cancel both defensively and retain barriers in both stores.
      const results = await Promise.all((owners.length ? owners : [native, reminders]).map(r => r.cancel(key)));
      return results.find(r => r.status === 'CANCEL_PENDING') ?? { status: 'CANCELLED', key };
    }),
    getSnapshot: () => serial(async () => {
      const states = await snapshots();
      const records = new Map<string, (typeof states)[number]['occurrences'][number]>();
      for (const record of states.flatMap(s => s.occurrences)) {
        const id = JSON.stringify([record.spec.userId, record.spec.requestId, record.spec.occurrenceId, record.spec.deviceId, record.spec.deviceEpoch]);
        const old = records.get(id);
        if (!old || record.spec.requestVersion > old.spec.requestVersion || record.spec.decisionRevision > old.spec.decisionRevision) records.set(id, record);
      }
      return { available: states.some(s => s.available), revision: states.reduce((sum, s) => sum + s.revision, 0), occurrences: [...records.values()] };
    }),
    async getCapabilities() {
      const [a, b] = await Promise.all([native.getCapabilities(), reminders.getCapabilities()]);
      return { ...a, available: a.available || b.available, notifications: b.notifications };
    },
  };
}
