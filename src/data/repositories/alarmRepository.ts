import { decisionToSummary, type AlarmSummary, type Clock } from '../../domain/alarms.ts';
import type { AlarmCommand, OperationReceipt, RespondToAlarm } from '../../domain/contracts/types.ts';
import { operationNameOf } from '../../domain/contracts/operations.ts';
import { parseOperation } from '../../domain/contracts/validate.ts';
import { DomainError } from '../../domain/errors.ts';
import type { AlarmRepository, ReconcileResult } from '../../domain/ports.ts';
import type { Decision, SchedulingStatus } from '../../domain/states.ts';
import type { IdGenerator } from '../../domain/ids.ts';
import type { AlarmRuntime } from '../../platform/alarms/index.ts';
import { OutboxWorker } from '../../platform/sync/outbox.ts';
import { ScheduleReconciler } from '../../platform/sync/reconciler.ts';
import { LocalStore } from '../local/store.ts';
import { SerialQueue, type AlarmGateway, type AlarmRecord, type LocalSchedule, type PendingOperation } from '../model.ts';
import { validateSyncPage } from '../remote/gateway.ts';

// All repository snapshots are serializable; this also works on RN engines without structuredClone.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const executionTime = (schedule: LocalSchedule) =>
  (schedule.snoozeCount ?? 0) > 0 && Number.isSafeInteger(schedule.scheduledAtEpochMs)
    ? schedule.scheduledAtEpochMs! : schedule.spec.effectiveAtEpochMs;
const currentExecution = (alarm: AlarmRecord, local: LocalSchedule) =>
  local.spec.requestVersion === alarm.request.requestVersion
  && local.spec.decisionRevision === alarm.recipient.decisionRevision
  && local.spec.deviceId === alarm.primaryDevice?.deviceId
  && local.spec.deviceEpoch === alarm.primaryDevice?.deviceEpoch
  && local.spec.mode === alarm.request.mode;

function selectLocalExecution(alarm: AlarmRecord, schedules: LocalSchedule[], now: number): LocalSchedule | undefined {
  const related = schedules.filter(item => item.groupId === alarm.groupId && item.spec.requestId === alarm.requestId);
  const current = related.filter(item => currentExecution(alarm, item));
  const upcoming = current.filter(item => item.status === 'SCHEDULED' && executionTime(item) > now)
    .sort((a, b) => executionTime(a) - executionTime(b));
  if (upcoming[0]) return upcoming[0];
  const unresolved = current.filter(item => !['CANCELLED', 'FIRED', 'EXPIRED'].includes(item.status));
  if (unresolved.length) return unresolved.sort((a, b) => b.spec.effectiveAtEpochMs - a.spec.effectiveAtEpochMs || b.updatedAt - a.updatedAt)[0];
  if (current.length) return current.sort((a, b) => b.spec.effectiveAtEpochMs - a.spec.effectiveAtEpochMs || b.updatedAt - a.updatedAt)[0];
  // A failed cancellation of a previous version must remain visible, never a fictitious cancellation.
  return related.filter(item => item.status === 'CANCEL_PENDING')
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export type AlarmView = {
  alarm: AlarmRecord;
  decision: Decision;
  pendingDecision?: RespondToAlarm['payload']['decision'];
  scheduling: SchedulingStatus;
  reason?: string;
  effectiveAtEpochMs: number;
  operationIds: string[];
  localSchedule?: LocalSchedule;
  deepLink: string;
};
export type DataSnapshot = {
  schemaVersion: 1; userId: string; generatedAtEpochMs: number; lastSyncedAtEpochMs: number | null;
  source: 'sqlite'; stale: boolean; alarms: AlarmView[]; operations: PendingOperation[];
};
export type PersistedWidgetSnapshot = {
  schemaVersion: 1; userId: string; generatedAtEpochMs: number; lastSyncedAtEpochMs: number | null;
  stale: boolean;
  groups: Array<{ groupId: string; pendingProposals: number; pendingActivation: number; pendingChanges: number; cancelPending: number;
    nextAlarm: { requestId: string; occurrenceId: string; mode: LocalSchedule['spec']['mode']; title: string; proposedBy: string; effectiveAtEpochMs: number;
      deepLink: string; acknowledgementPending: boolean } | null }>;
};
export class PendingOperationError extends DomainError {
  readonly operationId: string;
  constructor(operationId: string) {
    super('TEMPORARY_UNAVAILABLE', 'La acción está guardada y pendiente de confirmación.', { operationId });
    this.operationId = operationId;
  }
}
export type PersistentRepositoryOptions = {
  userId: string; deviceId: string; store: LocalStore; gateway: AlarmGateway; runtime: AlarmRuntime;
  notificationRuntime?: AlarmRuntime; clock: Clock; ids: IdGenerator;
  assertCurrent(): void;
  publishWidget?(snapshot: PersistedWidgetSnapshot | null): Promise<void>;
  random?: () => number;
};

export class PersistentAlarmRepository implements AlarmRepository {
  private readonly options: PersistentRepositoryOptions;
  private readonly outbox: OutboxWorker;
  private readonly reconciler: ScheduleReconciler;
  private flight: Promise<ReconcileResult> | undefined;
  private active = true;
  private fresh = false;
  private snapshot: DataSnapshot;
  private readonly listeners = new Set<(snapshot: DataSnapshot) => void>();
  private readonly publications = new SerialQueue();
  private readonly actions = new Set<Promise<unknown>>();
  constructor(options: PersistentRepositoryOptions) {
    this.options = options;
    const assertCurrent = () => { if (!this.active) throw new DomainError('UNAUTHENTICATED', 'El repositorio ya no pertenece a la sesión activa.'); options.assertCurrent(); };
    this.outbox = new OutboxWorker({ ...options, assertCurrent });
    this.reconciler = new ScheduleReconciler({ ...options, assertCurrent });
    this.snapshot = { schemaVersion: 1, userId: options.userId, generatedAtEpochMs: options.clock.nowEpochMs(),
      lastSyncedAtEpochMs: null, source: 'sqlite', stale: true, alarms: [], operations: [] };
  }
  private assertCurrent(): void {
    if (!this.active) throw new DomainError('UNAUTHENTICATED', 'La sesión ha cambiado.');
    this.options.assertCurrent();
  }

  /** UI can render persisted, explicitly stale state before the first successful network read. */
  async load(): Promise<void> { this.assertCurrent(); await this.refresh(); }
  subscribe(listener: (snapshot: DataSnapshot) => void): () => void {
    this.listeners.add(listener); listener(clone(this.snapshot));
    return () => { this.listeners.delete(listener); };
  }
  subscribeInbox(listener: (alarms: readonly AlarmSummary[]) => void): () => void {
    return this.subscribe(snapshot => listener(snapshot.alarms.map(view => ({
      id: view.alarm.requestId, title: view.alarm.request.title, proposedBy: view.alarm.request.creatorUid,
      scheduledAt: new Date(view.effectiveAtEpochMs).toISOString(), decision: decisionToSummary(view.decision),
      scheduling: view.scheduling === 'SCHEDULED' ? 'scheduled' : view.decision === 'ACCEPTED' ? 'pending_activation' : 'not_scheduled',
    }))));
  }
  getSnapshot(): DataSnapshot { return clone(this.snapshot); }

  enqueue(command: AlarmCommand): Promise<PendingOperation> {
    const action = this.enqueueInternal(command);
    this.actions.add(action);
    void action.finally(() => { this.actions.delete(action); }).catch(() => undefined);
    return action;
  }

  private async enqueueInternal(command: AlarmCommand): Promise<PendingOperation> {
    this.assertCurrent();
    const { store, userId, clock } = this.options;
    const kind = operationNameOf(command);
    if (kind === 'reportSchedule') throw new DomainError('FORBIDDEN', 'Los acuses sólo proceden de la reconciliación local.');
    const existing = (await store.operations(userId)).find(item => item.operationId === command.operationId);
    const parsed = parseOperation(kind, command, existing ? {} : { nowEpochMs: clock.nowEpochMs() });
    this.assertCurrent();
    await store.enqueue(userId, kind, parsed, clock.nowEpochMs());
    if (kind === 'respondToAlarm' && (parsed as RespondToAlarm).payload.decision !== 'ACCEPTED') {
      await this.reconciler.cancelRequest(parsed.groupId, parsed.entityId!);
    }
    await this.refresh();
    return (await store.operations(userId)).find(item => item.operationId === parsed.operationId)!;
  }

  /** Explicit retry after exhausting transient failures; never edits the persisted command. */
  async retryOperation(operationId: string): Promise<PendingOperation> {
    this.assertCurrent();
    const { store, userId, clock } = this.options;
    const operation = await store.retryTransientOperation(userId, operationId, clock.nowEpochMs());
    await this.refresh();
    return operation;
  }

  /** Preserves P1's receipt-only port: offline is durable, but cannot return a fake APPLIED. */
  async submit(command: AlarmCommand): Promise<OperationReceipt> {
    await this.enqueue(command);
    try { await this.reconcile(); } catch (error) {
      if (error instanceof DomainError && error.code === 'UNAUTHENTICATED') throw error;
    }
    this.assertCurrent();
    const item = (await this.options.store.operations(this.options.userId)).find(row => row.operationId === command.operationId)!;
    if (item.receipt) return item.receipt;
    if (item.state === 'CONFLICT' || item.state === 'FAILED_PERMANENT') {
      throw new DomainError(item.errorCode ?? 'INVALID_ARGUMENT', 'La acción requiere revisión antes de continuar.', { operationId: item.operationId });
    }
    throw new PendingOperationError(command.operationId);
  }

  reconcile(): Promise<ReconcileResult> {
    this.assertCurrent();
    if (this.flight) return this.flight;
    this.flight = this.run().finally(() => { this.flight = undefined; });
    return this.flight;
  }
  private async run(): Promise<ReconcileResult> {
    const { store, userId, gateway, clock } = this.options;
    this.fresh = false;
    let repairedSchedules = 0;
    try {
      await this.outbox.flush();
      this.assertCurrent();
      let cursor = (await store.syncState(userId)).cursor;
      let restartedExpiredCursor = false;
      let complete = false;
      for (let count = 0; count < 20; count++) {
        let remotePage;
        try { remotePage = await gateway.sync(cursor); }
        catch (error) {
          // A projection cursor expires independently of consent and the local outbox.
          // Replay the authoritative feed once; applyPage deduplicates old events and
          // still applies later revocations. Never infer revocation from missing rows.
          if (!restartedExpiredCursor && cursor !== null && error instanceof DomainError && error.code === 'EXPIRED') {
            this.assertCurrent();
            cursor = null;
            restartedExpiredCursor = true;
            continue;
          }
          throw error;
        }
        const page = validateSyncPage(remotePage, userId, cursor);
        this.assertCurrent();
        await store.applyPage(userId, page);
        cursor = page.nextCursor;
        // Apply cancellations even if a later page fails; new scheduling waits for the entire batch.
        await this.reconciler.reconcile(false);
        if (!page.hasMore) { complete = true; break; }
      }
      if (!complete) throw new DomainError('TEMPORARY_UNAVAILABLE', 'Quedan páginas por sincronizar.');
      repairedSchedules = await this.reconciler.reconcile(true);
      this.assertCurrent();
      await this.outbox.flush();
      this.fresh = true;
    } catch (error) {
      // Offline does not revoke an already registered alarm. Only apply known cancellations.
      try { this.assertCurrent(); await this.reconciler.reconcile(false); } catch { /* status remains pending */ }
      throw error;
    } finally {
      if (this.active) {
        try { this.assertCurrent(); await this.refresh(); } catch { /* no old session publication */ }
      }
    }
    const operations = await store.operations(userId);
    return { checkedAtEpochMs: clock.nowEpochMs(), pendingCommands: operations.filter(o => o.state === 'QUEUED' || o.state === 'SENDING').length,
      conflicts: operations.filter(o => o.state === 'CONFLICT').length, repairedSchedules };
  }

  private refresh(): Promise<void> {
    return this.publications.run(() => this.refreshAndPublish());
  }

  private async refreshAndPublish(): Promise<void> {
    this.assertCurrent();
    const { store, userId, clock } = this.options;
    const [alarms, operations, schedules, state] = await Promise.all([store.alarms(userId), store.operations(userId), store.schedules(userId), store.syncState(userId)]);
    this.assertCurrent();
    const views: AlarmView[] = alarms.map(alarm => {
      const related = operations.filter(op => op.command.groupId === alarm.groupId && op.command.entityId === alarm.requestId && op.lane === 'COMMAND' && op.state !== 'CONFIRMED');
      const pending = related.filter(op => op.kind === 'respondToAlarm' && (op.state === 'QUEUED' || op.state === 'SENDING')).at(-1);
      const local = selectLocalExecution(alarm, schedules, clock.nowEpochMs());
      const remote = alarm.schedules.filter(item => item.requestVersion === alarm.request.requestVersion
        && item.decisionRevision === alarm.recipient.decisionRevision && item.deviceEpoch === alarm.primaryDevice?.deviceEpoch
        && item.deviceId === alarm.primaryDevice.deviceId).sort((a, b) => b.statusUpdatedAtEpochMs - a.statusUpdatedAtEpochMs)[0];
      const execution = alarm.recipient.uid === userId ? local : remote;
      return { alarm, decision: alarm.recipient.decision,
        ...(pending ? { pendingDecision: (pending.command as RespondToAlarm).payload.decision } : {}),
        scheduling: execution?.status ?? 'NOT_SCHEDULED', reason: execution?.reason,
        effectiveAtEpochMs: local && alarm.recipient.uid === userId ? executionTime(local) : remote?.effectiveAtEpochMs
          ?? (alarm.recipient.chosenTimeSpec ?? alarm.request.timeSpec).effectiveAtEpochMs,
        operationIds: related.map(op => op.operationId), ...(alarm.recipient.uid === userId && local ? { localSchedule: local } : {}),
        deepLink: `alarmat://alarm/${encodeURIComponent(alarm.requestId)}` };
    });
    this.snapshot = { schemaVersion: 1, userId, generatedAtEpochMs: clock.nowEpochMs(), lastSyncedAtEpochMs: state.syncedAt,
      source: 'sqlite', stale: !this.fresh, alarms: views, operations };
    for (const listener of this.listeners) {
      try { listener(clone(this.snapshot)); } catch { /* a UI observer cannot interrupt cleanup or publication */ }
    }
    const widget = this.widgetSnapshot();
    await store.saveWidget(userId, widget);
    this.assertCurrent();
    await this.options.publishWidget?.(widget);
  }

  widgetSnapshot(): PersistedWidgetSnapshot {
    const snapshot = this.snapshot;
    const own = snapshot.alarms.filter(view => view.alarm.recipient.uid === snapshot.userId);
    return { schemaVersion: 1, userId: snapshot.userId, generatedAtEpochMs: snapshot.generatedAtEpochMs,
      lastSyncedAtEpochMs: snapshot.lastSyncedAtEpochMs, stale: snapshot.stale,
      groups: [...new Set(own.map(view => view.alarm.groupId))].sort().map(groupId => {
        const views = own.filter(view => view.alarm.groupId === groupId);
        const next = views.filter(view => view.decision === 'ACCEPTED' && view.alarm.request.status === 'ACTIVE'
          && view.scheduling === 'SCHEDULED' && !!view.localSchedule && currentExecution(view.alarm, view.localSchedule)
          && view.alarm.recipient.acceptedRequestVersion === view.alarm.request.requestVersion
          && view.pendingDecision !== 'DISABLED' && view.pendingDecision !== 'REJECTED'
          && view.effectiveAtEpochMs > this.options.clock.nowEpochMs())
          .sort((a, b) => a.effectiveAtEpochMs - b.effectiveAtEpochMs || a.alarm.requestId.localeCompare(b.alarm.requestId))[0];
        return { groupId, pendingProposals: views.filter(view => view.alarm.request.status === 'ACTIVE' && ['PENDING','NEEDS_REVIEW'].includes(view.decision)).length,
          pendingActivation: views.filter(view => view.decision === 'ACCEPTED' && view.scheduling !== 'SCHEDULED').length,
          pendingChanges: snapshot.operations.filter(op => op.command.groupId === groupId && op.state !== 'CONFIRMED').length,
          cancelPending: views.filter(view => view.scheduling === 'CANCEL_PENDING').length,
          nextAlarm: next ? { requestId: next.alarm.requestId, occurrenceId: next.localSchedule!.spec.occurrenceId,
            mode: next.localSchedule!.spec.mode, title: next.alarm.request.title, proposedBy: next.alarm.request.creatorUid,
            effectiveAtEpochMs: next.effectiveAtEpochMs, deepLink: next.deepLink,
            acknowledgementPending: !!next.localSchedule?.ackOperationId && snapshot.operations.some(op => op.operationId === next.localSchedule?.ackOperationId && op.state !== 'CONFIRMED') } : null };
      }) };
  }

  /** Call synchronously before switching identity to prevent all pending callbacks publishing. */
  deactivate(): void {
    this.active = false; this.fresh = false;
    this.snapshot = { ...this.snapshot, alarms: [], operations: [], stale: true, lastSyncedAtEpochMs: null };
    for (const listener of this.listeners) {
      try { listener(clone(this.snapshot)); } catch { /* a UI observer cannot interrupt cleanup or publication */ }
    }
    this.listeners.clear();
  }
  async whenIdle(): Promise<void> {
    await Promise.allSettled([...this.actions]);
    await this.flight?.catch(() => undefined);
    await this.reconciler.idle();
    await this.publications.run(async () => undefined);
  }

  async cleanup(preserveAccount = false): Promise<void> {
    this.deactivate();
    // The service aborts HTTP first. Wait for pending native work before deleting its recovery data.
    await this.whenIdle();
    // A publisher may already be awaiting native widget IO. Its completion must precede the clear.
    await this.publications.run(async () => { await this.options.publishWidget?.(null); });
    await this.reconciler.cleanup(preserveAccount);
  }
}
