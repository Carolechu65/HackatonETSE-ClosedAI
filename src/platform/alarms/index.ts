/** P4: frontera nativa. Ninguna operación de este puerto llama a Firebase. */
export interface OccurrenceKey {
  userId: string;
  requestId: string;
  occurrenceId: string;
  deviceId: string;
  deviceEpoch: number;
}

export interface LocalOccurrence extends OccurrenceKey {
  requestVersion: number;
  decisionRevision: number;
  effectiveAtEpochMs: number;
  timeZone: string;
  title: string;
  mode: 'ALARM' | 'NOTIFICATION';
}

export type ScheduleResult =
  | { status: 'SCHEDULED'; key: OccurrenceKey; scheduledAtEpochMs: number }
  | { status: 'PENDING_PERMISSION'; reason: string }
  | { status: 'FAILED'; reason: string };

export type CancelResult =
  | { status: 'CANCELLED'; key: OccurrenceKey }
  | { status: 'CANCEL_PENDING'; reason: string };

export interface AlarmCapabilities {
  available: boolean;
  exactAlarms: boolean;
  audibleAlarms: boolean;
  notifications: boolean;
  reason?: string;
}

export interface RuntimeSnapshot {
  available: boolean;
  revision: number;
  occurrences: Array<{
    spec: LocalOccurrence;
    status: 'SCHEDULING' | 'SCHEDULED' | 'CANCELLED' | 'FIRED' | 'FAILED' | 'EXPIRED';
  }>;
}

export interface AlarmRuntime {
  schedule(spec: LocalOccurrence): Promise<ScheduleResult>;
  cancel(key: OccurrenceKey): Promise<CancelResult>;
  getSnapshot(): Promise<RuntimeSnapshot>;
  getCapabilities(): Promise<AlarmCapabilities>;
}

export class AlarmRuntimeNotImplementedError extends Error {
  readonly code = 'E_NOT_IMPLEMENTED';

  constructor() {
    super('P4: implementar y validar el runtime Android antes de activar alarmas.');
    this.name = 'AlarmRuntimeNotImplementedError';
  }
}

/** Arranque seguro sin módulo nativo. No simula éxito ni solicita permisos. */
export const unavailableAlarmRuntime: AlarmRuntime = {
  async schedule() {
    throw new AlarmRuntimeNotImplementedError();
  },
  async cancel() {
    throw new AlarmRuntimeNotImplementedError();
  },
  async getSnapshot() {
    return { available: false, revision: 0, occurrences: [] };
  },
  async getCapabilities() {
    return {
      available: false,
      exactAlarms: false,
      audibleAlarms: false,
      notifications: false,
      reason: 'E_NOT_IMPLEMENTED',
    };
  },
};
