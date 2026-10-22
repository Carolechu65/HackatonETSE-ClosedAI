/**
 * Fakes deterministas para trabajar sin Firebase ni Android.
 *
 * No simulan éxito donde el contrato exige una comprobación real: el runtime falso
 * devuelve `PENDING_PERMISSION` o `FAILED` cuando se configura así, y el repositorio
 * en memoria pierde los datos al reiniciar, igual que el prototipo de P5.
 */
import type {
  AlarmCapabilities,
  AlarmRuntime,
  CancelResult,
  LocalOccurrence,
  OccurrenceKey,
  RuntimeSnapshot,
  ScheduleResult,
} from '../platform/alarms/index.ts';
import type { Clock } from './alarms.ts';
import { DomainError } from './errors.ts';
import { occurrenceKey, type OccurrenceIdentity } from './ids.ts';
import { operationNameOf } from './contracts/operations.ts';
import type { AlarmCommand, OperationReceipt } from './contracts/types.ts';
import { decisionToSummary, schedulingToSummary, type AlarmSummary } from './alarms.ts';
import type { AlarmRepository, ReconcileResult } from './ports.ts';

export type FakeClock = Clock & {
  set(epochMs: number): void;
  advance(deltaMs: number): void;
};

/** Reloj inyectable: nada del dominio llama a `Date.now()` directamente. */
export function createFakeClock(initialEpochMs = Date.parse('2026-10-22T09:00:00.000Z')): FakeClock {
  let current = initialEpochMs;
  return {
    nowEpochMs: () => current,
    set(epochMs: number) {
      current = epochMs;
    },
    advance(deltaMs: number) {
      current += deltaMs;
    },
  };
}

export type InMemoryAlarmRepository = AlarmRepository & {
  readonly commands: readonly AlarmCommand[];
  /** Fuerza el siguiente `submit` a fallar, para representar estado pendiente. */
  failNext(error?: DomainError): void;
};

export function createInMemoryAlarmRepository(options: {
  items?: readonly AlarmSummary[];
  clock?: Clock;
} = {}): InMemoryAlarmRepository {
  let items: AlarmSummary[] = (options.items ?? []).map((item) => ({ ...item }));
  const listeners = new Set<(items: readonly AlarmSummary[]) => void>();
  const commands: AlarmCommand[] = [];
  const clock = options.clock ?? createFakeClock();
  let pendingFailure: DomainError | null = null;

  const snapshot = (): AlarmSummary[] => items.map((item) => ({ ...item }));
  const emit = () => {
    const current = snapshot();
    for (const listener of listeners) listener(current);
  };

  return {
    get commands() {
      return [...commands];
    },
    failNext(error) {
      pendingFailure = error ?? new DomainError('TEMPORARY_UNAVAILABLE', 'Sin conexión.');
    },
    async submit(command) {
      const failure = pendingFailure;
      pendingFailure = null;
      if (failure) throw failure;
      commands.push(command);
      const name = operationNameOf(command);

      if (name === 'respondToAlarm' && 'decision' in command.payload) {
        const target = items.find((item) => item.id === command.entityId);
        if (!target) throw new DomainError('NOT_FOUND', 'La propuesta no existe en esta proyección.');
        const decision = command.payload.decision;
        items = items.map((item) => item.id === target.id
          ? {
              ...item,
              decision: decisionToSummary(decision),
              scheduling: schedulingToSummary(decision === 'ACCEPTED' ? 'PENDING_PERMISSION' : 'NOT_SCHEDULED'),
            }
          : item);
        emit();
      }

      const receipt: OperationReceipt = {
        operationId: command.operationId,
        status: commands.filter((candidate) => candidate.operationId === command.operationId).length > 1
          ? 'REPLAYED'
          : 'APPLIED',
        serverTimeEpochMs: clock.nowEpochMs(),
      };
      return receipt;
    },
    subscribeInbox(onChange) {
      listeners.add(onChange);
      onChange(snapshot());
      return () => {
        listeners.delete(onChange);
      };
    },
    async reconcile(): Promise<ReconcileResult> {
      return {
        checkedAtEpochMs: clock.nowEpochMs(),
        pendingCommands: 0,
        conflicts: 0,
        repairedSchedules: 0,
      };
    },
  };
}

export type FakeAlarmRuntimeOptions = {
  available?: boolean;
  exactAlarms?: boolean;
  audibleAlarms?: boolean;
  notifications?: boolean;
  reason?: string;
  /** Simula falta de permiso al programar una alarma audible. */
  permissionMissing?: boolean;
};

export type FakeAlarmRuntime = AlarmRuntime & {
  readonly scheduled: readonly { key: string; spec: LocalOccurrence; status: RuntimeSnapshot['occurrences'][number]['status'] }[];
  readonly calls: readonly string[];
};

export function createFakeAlarmRuntime(options: FakeAlarmRuntimeOptions = {}): FakeAlarmRuntime {
  const available = options.available ?? true;
  const permissionMissing = options.permissionMissing ?? false;
  const occurrences = new Map<string, { spec: LocalOccurrence; status: RuntimeSnapshot['occurrences'][number]['status'] }>();
  const calls: string[] = [];

  return {
    get scheduled() {
      return [...occurrences.entries()].map(([key, value]) => ({
        key,
        spec: value.spec,
        status: value.status,
      }));
    },
    get calls() {
      return [...calls];
    },
    async schedule(spec: LocalOccurrence): Promise<ScheduleResult> {
      calls.push('schedule');
      if (!available) return { status: 'FAILED', reason: 'E_NOT_IMPLEMENTED' };
      if (permissionMissing && spec.mode === 'ALARM') {
        return { status: 'PENDING_PERMISSION', reason: 'Falta el permiso de alarmas exactas.' };
      }
      const identity: OccurrenceIdentity = spec;
      occurrences.set(occurrenceKey(identity), { spec, status: 'SCHEDULED' });
      return { status: 'SCHEDULED', key: spec, scheduledAtEpochMs: spec.effectiveAtEpochMs };
    },
    async cancel(key: OccurrenceKey): Promise<CancelResult> {
      calls.push('cancel');
      if (!available) return { status: 'CANCEL_PENDING', reason: 'E_NOT_IMPLEMENTED' };
      const stored = occurrences.get(occurrenceKey(key));
      if (stored) occurrences.set(occurrenceKey(key), { ...stored, status: 'CANCELLED' });
      return { status: 'CANCELLED', key };
    },
    async getSnapshot(): Promise<RuntimeSnapshot> {
      return {
        available,
        revision: occurrences.size,
        occurrences: [...occurrences.values()].map((value) => ({ spec: value.spec, status: value.status })),
      };
    },
    async getCapabilities(): Promise<AlarmCapabilities> {
      const capabilities: AlarmCapabilities = {
        available,
        exactAlarms: available && (options.exactAlarms ?? true),
        audibleAlarms: available && (options.audibleAlarms ?? true),
        notifications: available && (options.notifications ?? true),
      };
      if (options.reason) capabilities.reason = options.reason;
      return capabilities;
    },
  };
}
