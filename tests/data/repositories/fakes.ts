import type { TestContext } from 'node:test';
import type { AlarmGateway, AlarmRecord } from '../../../src/data/model.ts';
import type { AlarmCommand, OperationKind, OperationReceipt, RespondToAlarm } from '../../../src/domain/contracts/types.ts';
import { DomainError } from '../../../src/domain/errors.ts';
import { createDeterministicIdGenerator, occurrenceKey } from '../../../src/domain/ids.ts';
import type { AlarmRuntime, LocalOccurrence, OccurrenceKey, RuntimeSnapshot } from '../../../src/platform/alarms/index.ts';
import { PersistentAlarmRepository, type PersistentRepositoryOptions, type PersistedWidgetSnapshot } from '../../../src/data/repositories/alarmRepository.ts';
import { ScheduleReconciler } from '../../../src/platform/sync/reconciler.ts';
import { openTestStore } from '../sqliteTestDatabase.ts';
import { alarm, page } from '../local/fixtures.ts';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

export class NativeRuntime implements AlarmRuntime {
  available = true;
  permission = true;
  cancellationFails = false;
  revision = 0;
  entries = new Map<string, RuntimeSnapshot['occurrences'][number]>();
  scheduled: LocalOccurrence[] = [];
  cancelled: OccurrenceKey[] = [];
  beforeSchedule?: () => Promise<void>;
  onSchedule?: (spec: LocalOccurrence) => void;
  async getCapabilities() { return { available: this.available, exactAlarms: this.permission, audibleAlarms: this.permission, notifications: this.permission }; }
  async getSnapshot(): Promise<RuntimeSnapshot> {
    return { available: this.available, revision: this.revision, occurrences: structuredClone([...this.entries.values()]) };
  }
  async schedule(spec: LocalOccurrence) {
    this.scheduled.push(structuredClone(spec)); this.onSchedule?.(spec);
    await this.beforeSchedule?.();
    if (!this.available) throw new Error('native missing');
    if (!this.permission) return { status: 'PENDING_PERMISSION' as const, reason: 'EXACT_ALARM_PERMISSION_REQUIRED' };
    this.entries.set(occurrenceKey(spec), { spec: structuredClone(spec), status: 'SCHEDULED' }); this.revision++;
    return { status: 'SCHEDULED' as const, key: spec, scheduledAtEpochMs: 1792701000000 };
  }
  async cancel(key: OccurrenceKey) {
    this.cancelled.push(structuredClone(key));
    if (!this.available || this.cancellationFails) return { status: 'CANCEL_PENDING' as const, reason: 'native missing' };
    const entry = this.entries.get(occurrenceKey(key));
    if (entry) entry.status = 'CANCELLED';
    this.revision++;
    return { status: 'CANCELLED' as const, key };
  }
}

export class Server implements AlarmGateway {
  records: AlarmRecord[];
  online = true;
  conflict = false;
  commands: { kind: OperationKind; command: AlarmCommand }[] = [];
  sequence = 0;
  trace: string[] = [];
  constructor(records: AlarmRecord[], privateNow: () => number) { this.records = structuredClone(records); this.now = privateNow; }
  private readonly now: () => number;
  async execute(kind: OperationKind, command: AlarmCommand): Promise<OperationReceipt> {
    this.commands.push({ kind, command: structuredClone(command) });
    this.trace.push(kind);
    if (!this.online) throw new DomainError('TEMPORARY_UNAVAILABLE', 'offline');
    if (this.conflict && kind === 'respondToAlarm') throw new DomainError('VERSION_CONFLICT', 'changed');
    const record = this.records.find(record => record.groupId === command.groupId && record.requestId === command.entityId)!;
    if (kind === 'respondToAlarm') {
      const response = command as RespondToAlarm;
      record.recipient = { uid: record.recipient.uid, receivedVersion: record.request.requestVersion, reception: 'RECEIVED',
        decision: response.payload.decision, decisionRevision: record.recipient.decisionRevision + 1, updatedAtEpochMs: this.now(),
        ...(response.payload.decision === 'ACCEPTED' ? { acceptedRequestVersion: record.request.requestVersion,
          consentScope: response.payload.consentScope, chosenTimeSpec: response.payload.chosenTimeSpec } : {}) };
    }
    return { operationId: command.operationId, status: 'APPLIED', serverTimeEpochMs: this.now(),
      requestVersion: record?.request.requestVersion ?? 1, decisionRevision: record?.recipient.decisionRevision ?? 1 };
  }
  async sync() {
    this.trace.push('sync');
    if (!this.online) throw new DomainError('TEMPORARY_UNAVAILABLE', 'offline');
    const sequence = ++this.sequence;
    return { nextCursor: `cursor-${sequence}`, hasMore: false, serverTimeEpochMs: this.now(),
      events: this.records.map((alarm, index) => ({ kind: 'upsert' as const, eventId: `event-${sequence}-${index}`, alarm: structuredClone(alarm) })) };
  }
}

export async function setup(t: TestContext, accepted = true, userId = 'ana') {
  const db = await openTestStore(); t.after(db.cleanup);
  const record = alarm(); record.request.mode = 'ALARM';
  if (!accepted) record.recipient = { uid: 'ana', receivedVersion: 1, reception: 'RECEIVED', decision: 'PENDING', decisionRevision: 1, updatedAtEpochMs: 1792701000000 };
  await db.store.applyPage(userId, page(record, 'initial', 'initial-cursor'));
  let now = 1792701000000;
  const clock = { nowEpochMs: () => now };
  const server = new Server([record], () => now);
  const runtime = new NativeRuntime();
  const widgets: (PersistedWidgetSnapshot | null)[] = [];
  let active = true;
  const options: PersistentRepositoryOptions = { userId, deviceId: 'dev-a1', store: db.store, gateway: server, runtime,
    notificationRuntime: runtime, clock, ids: createDeterministicIdGenerator(), random: () => 0,
    assertCurrent() { if (!active) throw new DomainError('UNAUTHENTICATED', 'old identity'); },
    async publishWidget(widget) { widgets.push(widget); } };
  const repository = new PersistentAlarmRepository(options);
  return { db, record, runtime, server, widgets, options, repository,
    reconciler: new ScheduleReconciler(options), setNow(value: number) { now = value; }, expire() { active = false; } };
}
