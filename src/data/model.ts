import type { AlarmRequestDocument, RecipientDocument, ScheduleDocument, AlarmCommand, OperationReceipt, OperationKind } from '../domain/contracts/types.ts';
import type { AppErrorCode } from '../domain/errors.ts';
import type { SchedulingStatus, SyncStatus } from '../domain/states.ts';
import type { LocalOccurrence } from '../platform/alarms/index.ts';

/** Internal normalized projection, NOT a new HTTP envelope. P3 supplies the wire decoder. */
export type AlarmRecord = {
  groupId: string;
  requestId: string;
  request: AlarmRequestDocument;
  recipient: RecipientDocument;
  primaryDevice: { deviceId: string; deviceEpoch: number } | null;
  schedules: ScheduleDocument[];
};
export type SyncEvent =
  | { eventId: string; kind: 'upsert'; alarm: AlarmRecord }
  | { eventId: string; kind: 'revoke'; groupId: string; requestId?: string };
export type SyncPage = { events: SyncEvent[]; nextCursor: string; hasMore: boolean; serverTimeEpochMs: number };
export type PendingOperation = {
  operationId: string;
  kind: OperationKind;
  command: AlarmCommand;
  lane: 'COMMAND' | 'ACK';
  state: SyncStatus;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  errorCode?: AppErrorCode;
  receipt?: OperationReceipt;
};
export type LocalSchedule = {
  groupId: string;
  spec: LocalOccurrence;
  status: SchedulingStatus;
  updatedAt: number;
  reason?: string;
  ackOperationId?: string;
};
export type CancellationBarrier = {
  groupId: string;
  requestId: string;
  requestVersion: number;
  decisionRevision: number;
  /** Only a later, explicit, server-confirmed local acceptance can release this barrier. */
  operationId: string;
};
export interface AlarmGateway {
  execute(kind: OperationKind, command: AlarmCommand): Promise<OperationReceipt>;
  sync(cursor: string | null): Promise<SyncPage>;
}

/** Serializes local transactions/effects, never hold it across a network request. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(action);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
