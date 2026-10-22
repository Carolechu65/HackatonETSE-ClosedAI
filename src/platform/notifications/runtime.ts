import type { AlarmRuntime, CancelResult, LocalOccurrence, OccurrenceKey, RuntimeSnapshot, ScheduleResult } from '../alarms/index.ts';

export interface NotificationRecord {
  id: string;
  key: OccurrenceKey;
  spec?: LocalOccurrence;
  status: RuntimeSnapshot['occurrences'][number]['status'];
}
export interface NotificationDriver {
  read(): Promise<{ revision: number; records: NotificationRecord[] }>;
  write(record: NotificationRecord): Promise<void>;
  permission(): Promise<boolean>;
  schedule(id: string, spec: LocalOccurrence): Promise<void>;
  cancel(id: string): Promise<void>;
  registered(): Promise<Set<string>>;
  presented(): Promise<Set<string>>;
}
export const notificationIdentity = (key: OccurrenceKey): string => 'alarmat-reminder:' + JSON.stringify([
  key.userId, key.requestId, key.occurrenceId, key.deviceId, key.deviceEpoch,
]);
const keyOf = (s: OccurrenceKey): OccurrenceKey => ({ userId: s.userId, requestId: s.requestId, occurrenceId: s.occurrenceId, deviceId: s.deviceId, deviceEpoch: s.deviceEpoch });

/** Serializes disk and OS operations. Tombstones are committed before cancellation. */
export function notificationRuntime(driver: NotificationDriver, now = Date.now): AlarmRuntime {
  let pending: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation, operation);
    pending = result.catch(() => {});
    return result;
  }
  async function schedule(spec: LocalOccurrence): Promise<ScheduleResult> {
    if (spec.mode !== 'NOTIFICATION') return { status: 'FAILED', reason: 'UNSUPPORTED_MODE' };
    if (![spec.deviceEpoch, spec.requestVersion, spec.decisionRevision, spec.effectiveAtEpochMs].every(v => Number.isSafeInteger(v) && v > 0) ||
      ![spec.userId, spec.requestId, spec.occurrenceId, spec.deviceId, spec.title, spec.timeZone].every(v => typeof v === 'string' && v.length > 0 && v.length <= 512))
      return { status: 'FAILED', reason: 'INVALID_ARGUMENT' };
    if (spec.effectiveAtEpochMs <= now()) return { status: 'FAILED', reason: 'EXPIRED' };
    const id = notificationIdentity(spec);
    const { records } = await driver.read();
    const previous = records.find(r => r.id === id);
    if (previous?.status === 'CANCELLED' && (!previous.spec || spec.requestVersion < previous.spec.requestVersion || spec.decisionRevision <= previous.spec.decisionRevision))
      return { status: 'FAILED', reason: 'CANCELLED_OCCURRENCE' };
    const sameDevice = records.filter(r => r.key.userId === spec.userId && r.key.deviceId === spec.deviceId);
    const sameRequest = sameDevice.filter(r => r.key.requestId === spec.requestId);
    if (sameDevice.some(r => r.key.deviceEpoch > spec.deviceEpoch) || sameRequest.some(r => r.spec && (r.spec.requestVersion > spec.requestVersion || r.spec.decisionRevision > spec.decisionRevision)))
      return { status: 'FAILED', reason: 'STALE_VERSION' };
    if (previous?.spec?.requestVersion === spec.requestVersion && previous.spec.decisionRevision === spec.decisionRevision) {
      if (Object.keys(spec).some(k => spec[k as keyof LocalOccurrence] !== previous.spec![k as keyof LocalOccurrence])) return { status: 'FAILED', reason: 'VERSION_PAYLOAD_CONFLICT' };
      if (['FIRED', 'EXPIRED'].includes(previous.status)) return { status: 'FAILED', reason: 'OCCURRENCE_ALREADY_FINISHED' };
    }
    for (const record of sameDevice.filter(r => r.key.deviceEpoch < spec.deviceEpoch || r.key.requestId === spec.requestId && r.spec && (r.spec.requestVersion < spec.requestVersion || r.spec.decisionRevision < spec.decisionRevision))) {
      await driver.write({ ...record, status: 'CANCELLED' });
      await driver.cancel(record.id);
    }
    const record: NotificationRecord = { id, key: keyOf(spec), spec, status: 'SCHEDULING' };
    if (!await driver.permission()) {
      await driver.write({ ...record, status: 'FAILED' });
      await driver.cancel(id);
      return { status: 'PENDING_PERMISSION', reason: 'NOTIFICATION_PERMISSION' };
    }
    await driver.write(record);
    try {
      await driver.schedule(id, spec);
      await driver.write({ ...record, status: 'SCHEDULED' });
      return { status: 'SCHEDULED', key: keyOf(spec), scheduledAtEpochMs: now() };
    } catch {
      await driver.cancel(id);
      await driver.write({ ...record, status: 'FAILED' });
      return { status: 'FAILED', reason: 'NOTIFICATION_SCHEDULE_FAILED' };
    }
  }
  async function cancel(key: OccurrenceKey): Promise<CancelResult> {
    try {
      const id = notificationIdentity(key);
      const previous = (await driver.read()).records.find(r => r.id === id);
      await driver.write({ ...previous, id, key, status: 'CANCELLED' });
      await driver.cancel(id);
      return { status: 'CANCELLED', key };
    } catch { return { status: 'CANCEL_PENDING', reason: 'NOTIFICATION_CANCEL_FAILED' }; }
  }
  async function snapshot(): Promise<RuntimeSnapshot> {
    const { records } = await driver.read();
    const [registered, presented, allowed] = await Promise.all([driver.registered(), driver.presented(), driver.permission()]);
    for (const record of records) {
      if (record.status === 'CANCELLED') { await driver.cancel(record.id); continue; }
      if (!record.spec || !['SCHEDULED', 'SCHEDULING'].includes(record.status)) continue;
      if (record.spec.effectiveAtEpochMs <= now()) {
        await driver.write({ ...record, status: presented.has(record.id) ? 'FIRED' : 'EXPIRED' });
        if (!presented.has(record.id)) await driver.cancel(record.id);
      } else if (!allowed) {
        await driver.write({ ...record, status: 'FAILED' });
        await driver.cancel(record.id);
      } else if (!registered.has(record.id)) {
        await schedule(record.spec);
      } else if (record.status === 'SCHEDULING') {
        await driver.write({ ...record, status: 'SCHEDULED' });
      }
    }
    const state = await driver.read();
    return { available: true, revision: state.revision, occurrences: state.records.flatMap(r => r.spec ? [{ spec: r.spec, status: r.status }] : []) };
  }
  return {
    schedule: spec => serial(() => schedule(spec)),
    cancel: key => serial(() => cancel(key)),
    getSnapshot: () => serial(snapshot),
    async getCapabilities() { return { available: true, exactAlarms: false, audibleAlarms: false, notifications: await driver.permission() }; },
  };
}
