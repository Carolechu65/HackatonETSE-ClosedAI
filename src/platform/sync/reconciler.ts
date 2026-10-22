import type { Clock } from '../../domain/alarms.ts';
import { hasCurrentConsent } from '../../domain/consent.ts';
import type { AlarmCommand } from '../../domain/contracts/types.ts';
import { occurrenceIdFromEpochMs, occurrenceKey, type IdGenerator } from '../../domain/ids.ts';
import { nextWeeklyOccurrence } from '../../domain/time.ts';
import { isScheduleReportStatus } from '../../domain/states.ts';
import type { AlarmRuntime, LocalOccurrence, RuntimeSnapshot, ScheduleResult } from '../alarms/index.ts';
import { unavailableAlarmRuntime } from '../alarms/index.ts';
import { LocalStore } from '../../data/local/store.ts';
import { canonicalJson, SerialQueue, type AlarmRecord, type LocalSchedule } from '../../data/model.ts';

const sameEntity = (alarm: AlarmRecord, schedule: LocalSchedule) =>
  alarm.groupId === schedule.groupId && alarm.requestId === schedule.spec.requestId;
const sameSpec = (a: LocalOccurrence, b: LocalOccurrence) => canonicalJson(a) === canonicalJson(b);
const terminal = (status: LocalSchedule['status']) => ['CANCELLED', 'FIRED', 'EXPIRED'].includes(status);

export type ReconcilerOptions = {
  userId: string; deviceId: string; store: LocalStore; runtime: AlarmRuntime;
  /** Dedicated NOTIFICATION scheduler supplied by P4. Never fall back to audible runtime. */
  notificationRuntime?: AlarmRuntime;
  clock: Clock; ids: IdGenerator; assertCurrent(): void;
};

/** All native mutations are serialized, but a local cancellation never waits for HTTP. */
export class ScheduleReconciler {
  private readonly options: ReconcilerOptions;
  private readonly effects = new SerialQueue();
  private readonly executionBlocks = new Map<LocalOccurrence['mode'], { status: 'FAILED' | 'PENDING_PERMISSION'; reason: string }>();
  constructor(options: ReconcilerOptions) { this.options = options; }
  private runtime(mode: LocalOccurrence['mode']): AlarmRuntime {
    return mode === 'ALARM' ? this.options.runtime : this.options.notificationRuntime ?? unavailableAlarmRuntime;
  }

  private desired(alarm: AlarmRecord): LocalOccurrence | null {
    const { userId, deviceId, clock } = this.options;
    const { request, recipient, primaryDevice } = alarm;
    if (recipient.uid !== userId || primaryDevice?.deviceId !== deviceId || request.status !== 'ACTIVE'
      || !hasCurrentConsent({ decision: recipient.decision, acceptedRequestVersion: recipient.acceptedRequestVersion, requestVersion: request.requestVersion })
      || !recipient.consentScope) return null;
    const time = recipient.chosenTimeSpec ?? request.timeSpec;
    let effectiveAtEpochMs = time.effectiveAtEpochMs;
    if (effectiveAtEpochMs <= clock.nowEpochMs()) {
      if (!request.recurrence || recipient.consentScope !== 'SERIES') return null;
      // A changed civil time applies to the accepted weekly slot, never to the task deadline.
      const next = nextWeeklyOccurrence({ ...request.recurrence, localTime: time.localTime }, time.timeZone, clock.nowEpochMs());
      if (next === null) return null;
      effectiveAtEpochMs = next;
    }
    return { userId, requestId: alarm.requestId, occurrenceId: occurrenceIdFromEpochMs(effectiveAtEpochMs),
      deviceId, deviceEpoch: primaryDevice.deviceEpoch, requestVersion: request.requestVersion,
      decisionRevision: recipient.decisionRevision, effectiveAtEpochMs, timeZone: time.timeZone, title: request.title, mode: request.mode };
  }

  /** Persist execution and ACK in one local transaction, with stable ID across retries. */
  private async record(schedule: LocalSchedule, alarm?: AlarmRecord): Promise<void> {
    const { store, userId, ids, clock } = this.options;
    const old = (await store.schedules(userId)).find(item => occurrenceKey(item.spec) === occurrenceKey(schedule.spec));
    let ack: AlarmCommand | undefined;
    if (alarm && alarm.recipient.uid === userId && alarm.primaryDevice?.deviceId === schedule.spec.deviceId
      && alarm.primaryDevice.deviceEpoch === schedule.spec.deviceEpoch
      && alarm.request.requestVersion === schedule.spec.requestVersion
      && alarm.recipient.decisionRevision === schedule.spec.decisionRevision
      && isScheduleReportStatus(schedule.status)) {
      const payload = { occurrenceId: schedule.spec.occurrenceId, deviceId: schedule.spec.deviceId,
        deviceEpoch: schedule.spec.deviceEpoch, requestVersion: schedule.spec.requestVersion,
        decisionRevision: schedule.spec.decisionRevision, mode: schedule.spec.mode,
        mechanism: schedule.spec.mode === 'ALARM' ? 'ALARM_RUNTIME' as const : 'EXPO_NOTIFICATIONS' as const,
        status: schedule.status, effectiveAtEpochMs: schedule.spec.effectiveAtEpochMs,
        ...(schedule.reason ? { reason: schedule.reason } : {}) };
      const previous = old?.ackOperationId
        ? (await store.operations(userId)).find(operation => operation.operationId === old.ackOperationId) : undefined;
      const previousPayload = previous?.command.payload as Record<string, unknown> | undefined;
      const { reportedAtEpochMs: _reported, ...previousComparable } = previousPayload ?? {};
      if (canonicalJson(previousComparable) !== canonicalJson(payload)) {
        ack = { schemaVersion: 1, operationId: ids.next('ack'), groupId: schedule.groupId, entityId: schedule.spec.requestId,
          payload: { ...payload, reportedAtEpochMs: clock.nowEpochMs() } };
      }
    }
    const unchanged = old && sameSpec(old.spec, schedule.spec) && old.status === schedule.status && old.reason === schedule.reason;
    await store.saveSchedule(userId, { ...schedule, updatedAt: unchanged ? old.updatedAt : schedule.updatedAt,
      ackOperationId: ack?.operationId ?? old?.ackOperationId }, ack);
  }

  private async cancel(schedule: LocalSchedule, alarm?: AlarmRecord): Promise<boolean> {
    const { clock } = this.options;
    let status: 'CANCELLED' | 'CANCEL_PENDING' = 'CANCEL_PENDING';
    let reason: string | undefined;
    try {
      const result = await this.runtime(schedule.spec.mode).cancel(schedule.spec);
      status = result.status;
      if (result.status === 'CANCEL_PENDING') reason = result.reason.slice(0, 200) || 'Cancelación pendiente.';
      else if (occurrenceKey(result.key) !== occurrenceKey(schedule.spec)) {
        status = 'CANCEL_PENDING'; reason = 'El runtime devolvió otra identidad.';
      }
    } catch { reason = 'Runtime no disponible; cancelación pendiente.'; }
    // Cancellation is an observed result of THIS reconciliation decision. A past FIRED/SCHEDULED
    // result is never relabelled; only the just-confirmed cancellation can acknowledge new terms.
    const spec = alarm && alarm.primaryDevice?.deviceId === schedule.spec.deviceId
      && alarm.primaryDevice.deviceEpoch === schedule.spec.deviceEpoch
      && (alarm.request.status !== 'ACTIVE' || alarm.recipient.decision !== 'ACCEPTED'
        || alarm.recipient.acceptedRequestVersion !== alarm.request.requestVersion)
      ? { ...schedule.spec, requestVersion: alarm.request.requestVersion, decisionRevision: alarm.recipient.decisionRevision }
      : schedule.spec;
    await this.record({ ...schedule, spec, status, reason, updatedAt: clock.nowEpochMs() }, alarm);
    return status === 'CANCELLED';
  }

  cancelRequest(groupId: string, requestId: string): Promise<void> {
    return this.effects.run(async () => {
      const { store, userId } = this.options;
      await this.recoverSnapshots();
      const alarm = (await store.alarms(userId)).find(item => item.groupId === groupId && item.requestId === requestId && item.recipient.uid === userId);
      for (const schedule of await store.schedules(userId)) {
        if (schedule.groupId === groupId && schedule.spec.requestId === requestId && !terminal(schedule.status)) await this.cancel(schedule, alarm);
      }
    });
  }

  private async snapshot(mode: LocalOccurrence['mode']): Promise<RuntimeSnapshot | null> {
    try {
      const snapshot = await this.runtime(mode).getSnapshot();
      if (!snapshot.available || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) return null;
      return snapshot;
    } catch { return null; }
  }

  /** Recover a native commit even when the app died before saving its result/outbox. */
  private async recoverSnapshots(): Promise<Map<LocalOccurrence['mode'], RuntimeSnapshot>> {
    const { store, userId, clock } = this.options;
    const snapshots = new Map<LocalOccurrence['mode'], RuntimeSnapshot>();
    const alarms = await store.alarms(userId);
    const barriers = await store.barriers(userId);
    for (const mode of ['ALARM', 'NOTIFICATION'] as const) {
      this.executionBlocks.delete(mode);
      try {
        const capabilities = await this.runtime(mode).getCapabilities();
        if (!capabilities.available) this.executionBlocks.set(mode, { status: 'FAILED', reason: capabilities.reason?.slice(0, 200) || 'RUNTIME_UNAVAILABLE' });
        else if ((mode === 'ALARM' && (!capabilities.exactAlarms || !capabilities.audibleAlarms))
          || (mode === 'NOTIFICATION' && !capabilities.notifications)) {
          this.executionBlocks.set(mode, { status: 'PENDING_PERMISSION', reason: capabilities.reason?.slice(0, 200)
            || (mode === 'ALARM' ? 'EXACT_ALARM_PERMISSION_REQUIRED' : 'NOTIFICATION_PERMISSION_REQUIRED') });
        }
      } catch { this.executionBlocks.set(mode, { status: 'FAILED', reason: 'RUNTIME_UNAVAILABLE' }); }
      const snapshot = await this.snapshot(mode);
      if (!snapshot) continue;
      // Native revision is only for the audible store; notification adapter has its own authority.
      if (mode === 'ALARM' && snapshot.revision < (await store.syncState(userId)).runtimeRevision) continue;
      snapshots.set(mode, snapshot);
      for (const entry of snapshot.occurrences) {
        if (entry.spec.userId !== userId || entry.spec.mode !== mode) continue;
        const old = (await store.schedules(userId)).find(item => occurrenceKey(item.spec) === occurrenceKey(entry.spec));
        if (old && (entry.spec.requestVersion < old.spec.requestVersion
          || entry.spec.decisionRevision < old.spec.decisionRevision)) continue;
        const alarm = alarms.find(item => item.requestId === entry.spec.requestId && item.recipient.uid === userId);
        const groupId = old?.groupId ?? alarm?.groupId;
        // An orphan still needs cancelling (e.g. logout interrupted before local persistence).
        if (!groupId) {
          if (!terminal(entry.status)) {
            const cancelled = await this.runtime(mode).cancel(entry.spec);
            if (cancelled.status !== 'CANCELLED' || occurrenceKey(cancelled.key) !== occurrenceKey(entry.spec)) {
              throw new Error('Queda una ocurrencia huérfana pendiente de cancelación.');
            }
          }
          continue;
        }
        if (old && sameSpec(old.spec, entry.spec) && terminal(old.status) && !terminal(entry.status)) continue;
        if (old?.status === 'CANCEL_PENDING' && !terminal(entry.status)) continue;
        const block = entry.status === 'SCHEDULED' || entry.status === 'SCHEDULING' ? this.executionBlocks.get(mode) : undefined;
        await this.record({ groupId, spec: entry.spec, status: entry.status, updatedAt: clock.nowEpochMs(),
          ...(entry.status === 'FAILED' ? { reason: 'El runtime informa de un fallo de ejecución.' } : {}), ...block },
        alarm && entry.spec.requestVersion === alarm.request.requestVersion
          && entry.spec.decisionRevision === alarm.recipient.decisionRevision
          && !barriers.some(barrier => barrier.groupId === groupId && barrier.requestId === entry.spec.requestId)
          ? alarm : undefined);
      }
      if (mode === 'ALARM') await store.saveRuntimeRevision(userId, snapshot.revision);
    }
    return snapshots;
  }

  reconcile(allowNewSchedules: boolean): Promise<number> {
    return this.effects.run(async () => {
      const { store, userId, clock, assertCurrent } = this.options;
      assertCurrent();
      const snapshots = await this.recoverSnapshots();
      assertCurrent();
      const alarms = await store.alarms(userId);
      for (const alarm of alarms) if (alarm.recipient.uid === userId) await store.releaseBarrier(userId, alarm);
      let barriers = await store.barriers(userId);
      const blocked = (alarm: AlarmRecord) => barriers.some(b => b.groupId === alarm.groupId && b.requestId === alarm.requestId);
      // Retire old versions, withdrawn requests, old principals, and revoked groups first.
      for (const schedule of await store.schedules(userId)) {
        assertCurrent();
        const alarm = alarms.find(item => sameEntity(item, schedule) && item.recipient.uid === userId);
        const wanted = alarm && !blocked(alarm) ? this.desired(alarm) : null;
        if (terminal(schedule.status)) {
          // An offline disable may have completed before its newer server decision arrived.
          // Reconfirm cancellation for that decision; never re-tag an old execution event.
          if (schedule.status === 'CANCELLED' && alarm && !wanted
            && (schedule.spec.requestVersion !== alarm.request.requestVersion
              || schedule.spec.decisionRevision !== alarm.recipient.decisionRevision)) await this.cancel(schedule, alarm);
          else if (alarm) await this.record(schedule, alarm);
          continue;
        }
        if (!wanted || !sameSpec(wanted, schedule.spec)) await this.cancel(schedule, alarm);
      }
      if (!allowNewSchedules) return 0;
      let scheduled = 0;
      for (const alarm of alarms) {
        assertCurrent();
        barriers = await store.barriers(userId);
        const wanted = !blocked(alarm) ? this.desired(alarm) : null;
        if (!wanted) continue;
        const schedules = await store.schedules(userId);
        const old = schedules.find(item => occurrenceKey(item.spec) === occurrenceKey(wanted));
        if (schedules.some(item => sameEntity(alarm, item) && item.status === 'CANCEL_PENDING')) continue;
        // A native tombstone/fired event for this decision wins over an old server snapshot.
        if (old && sameSpec(old.spec, wanted) && terminal(old.status)) continue;
        const snapshot = snapshots.get(wanted.mode);
        const native = snapshot?.occurrences.find(entry => occurrenceKey(entry.spec) === occurrenceKey(wanted) && sameSpec(entry.spec, wanted));
        const block = this.executionBlocks.get(wanted.mode);
        if (block) {
          await this.record({ groupId: alarm.groupId, spec: wanted, ...block, updatedAt: clock.nowEpochMs() }, alarm);
          continue;
        }
        if (native?.status === 'SCHEDULED' || native?.status === 'FIRED') continue;
        // No blind scheduling without the execution authority's snapshot.
        if (!snapshot) {
          await this.record({ groupId: alarm.groupId, spec: wanted, status: 'FAILED', reason: 'Runtime no disponible.', updatedAt: clock.nowEpochMs() }, alarm);
          continue;
        }
        await store.saveSchedule(userId, { groupId: alarm.groupId, spec: wanted, status: 'SCHEDULING', updatedAt: clock.nowEpochMs() });
        assertCurrent();
        // Check again after persisting intent: a concurrently queued disable wins.
        if ((await store.barriers(userId)).some(b => b.groupId === alarm.groupId && b.requestId === alarm.requestId)) continue;
        let result: ScheduleResult;
        try { result = await this.runtime(wanted.mode).schedule(wanted); }
        catch { result = { status: 'FAILED' as const, reason: 'Runtime no disponible.' }; }
        // A cancellation queued while native schedule was in flight is applied before any success ACK.
        if ((await store.barriers(userId)).some(b => b.groupId === alarm.groupId && b.requestId === alarm.requestId)) {
          await this.cancel({ groupId: alarm.groupId, spec: wanted, status: 'CANCEL_PENDING', updatedAt: clock.nowEpochMs() }, alarm);
          continue;
        }
        try { assertCurrent(); } catch (error) {
          await this.cancel({ groupId: alarm.groupId, spec: wanted, status: 'CANCEL_PENDING', updatedAt: clock.nowEpochMs() });
          throw error;
        }
        if (result.status === 'SCHEDULED' && occurrenceKey(result.key) !== occurrenceKey(wanted)) {
          result = { status: 'FAILED', reason: 'El runtime devolvió otra identidad.' };
        }
        await this.record({ groupId: alarm.groupId, spec: wanted, status: result.status,
          updatedAt: clock.nowEpochMs(), ...(result.status !== 'SCHEDULED'
            ? { reason: result.reason.slice(0, 200) || 'No se pudo confirmar la programación local.' } : {}) }, alarm);
        if (result.status === 'SCHEDULED') scheduled++;
      }
      return scheduled;
    });
  }

  idle(): Promise<void> { return this.effects.run(async () => undefined); }

  /** Cleanup is durable and fail-closed: a second account cannot inherit active alarms. */
  cleanup(preserveAccount = false): Promise<void> {
    return this.effects.run(async () => {
      const { store, userId } = this.options;
      await store.beginCleanup(userId);
      const snapshots = await this.recoverSnapshots();
      let pending = false;
      for (const schedule of await store.schedules(userId)) {
        if (!terminal(schedule.status) && !await this.cancel(schedule)) pending = true;
      }
      // A known unavailable runtime is safe only when no local intent exists for it.
      for (const mode of ['ALARM', 'NOTIFICATION'] as const) {
        if (!snapshots.has(mode) && (await store.schedules(userId)).some(item => item.spec.mode === mode && !terminal(item.status))) pending = true;
      }
      if (pending) throw new Error('Quedan cancelaciones locales pendientes. Reintenta antes de cambiar de cuenta.');
      await store.clearUser(userId, preserveAccount);
    });
  }
}
