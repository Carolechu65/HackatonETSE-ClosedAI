import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Frontera TypeScript → runtime Android.
 *
 * El runtime es la autoridad de ejecución local de una ocurrencia. Este
 * adaptador no llama a Firebase ni simula éxito: si el módulo nativo no está
 * instalado (Expo Go, web o build antigua) devuelve `unavailableAlarmRuntime`.
 */
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

export type SnoozeResult = {
  status: 'SCHEDULED' | 'PENDING_PERMISSION' | 'FAILED' | 'EXPIRED';
  reason?: string | null;
  scheduledAtEpochMs?: number | null;
};

export type RuntimeStatus =
  | 'SCHEDULING'
  | 'SCHEDULED'
  | 'CANCELLED'
  | 'FIRED'
  | 'FAILED'
  | 'EXPIRED';

export interface RuntimeOccurrence {
  spec: LocalOccurrence;
  status: RuntimeStatus;
  scheduledAtEpochMs?: number;
  firedAtEpochMs?: number;
  dismissedAtEpochMs?: number;
  snoozeCount?: number;
  failureReason?: string;
}

export interface AlarmCapabilities {
  available: boolean;
  exactAlarms: boolean;
  audibleAlarms: boolean;
  notifications: boolean;
  fullScreenIntent: boolean;
  reason?: string | null;
}

export interface RuntimeSnapshot {
  available: boolean;
  revision: number;
  occurrences: RuntimeOccurrence[];
}

export interface RecoveryResult {
  rescheduled: number;
  expired: number;
  failed: number;
  reason?: string;
}

export interface AlarmRuntime {
  schedule(spec: LocalOccurrence): Promise<ScheduleResult>;
  cancel(key: OccurrenceKey): Promise<CancelResult>;
  /** Detiene una alarma sonando o cancela una que aún no ha llegado. */
  stop(key: OccurrenceKey): Promise<boolean>;
  /** Reagenda la misma ocurrencia (identidad estable) dentro de N minutos. */
  snooze(key: OccurrenceKey, minutes?: number): Promise<SnoozeResult>;
  /** Repara alarmas futuras tras reinicio/proceso muerto; no resucita vencidas. */
  reconcile(): Promise<RecoveryResult>;
  getSnapshot(): Promise<RuntimeSnapshot>;
  getCapabilities(): Promise<AlarmCapabilities>;
  requestExactAlarmPermission(): Promise<boolean>;
  requestNotificationPermission(): Promise<boolean>;
  openNotificationSettings(): Promise<boolean>;
  openFullScreenIntentSettings(): Promise<boolean>;
}

type NativeAlarmRuntime = {
  schedule(spec: LocalOccurrence): Promise<ScheduleResult>;
  cancel(key: OccurrenceKey): Promise<CancelResult>;
  stop(key: OccurrenceKey): Promise<boolean>;
  snooze(key: OccurrenceKey, minutes: number): Promise<SnoozeResult>;
  reconcile(): Promise<RecoveryResult>;
  getSnapshot(): Promise<RuntimeSnapshot>;
  getCapabilities(): Promise<AlarmCapabilities>;
  requestExactAlarmPermission(): Promise<boolean>;
  requestNotificationPermission(): Promise<boolean>;
  openNotificationSettings(): Promise<boolean>;
  openFullScreenIntentSettings(): Promise<boolean>;
};

export class AlarmRuntimeNotImplementedError extends Error {
  readonly code = 'E_NOT_IMPLEMENTED';

  constructor() {
    super('El runtime Android no está instalado. Usa una development build, no Expo Go.');
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
  async stop() {
    throw new AlarmRuntimeNotImplementedError();
  },
  async snooze() {
    throw new AlarmRuntimeNotImplementedError();
  },
  async reconcile() {
    return { rescheduled: 0, expired: 0, failed: 0, reason: 'E_NOT_IMPLEMENTED' };
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
      fullScreenIntent: false,
      reason: 'E_NOT_IMPLEMENTED',
    };
  },
  async requestExactAlarmPermission() {
    return false;
  },
  async requestNotificationPermission() {
    return false;
  },
  async openNotificationSettings() {
    return false;
  },
  async openFullScreenIntentSettings() {
    return false;
  },
};

function loadNativeRuntime(): NativeAlarmRuntime | null {
  try {
    return requireOptionalNativeModule<NativeAlarmRuntime>('AlarmRuntime');
  } catch {
    return null;
  }
}

/**
 * Se resuelve una vez por proceso. Requiere development build: en Expo Go el
 * módulo local no existe y la UI debe mostrar «no disponible», no programar.
 */
export function createAlarmRuntime(): AlarmRuntime {
  const native = loadNativeRuntime();
  if (!native) return unavailableAlarmRuntime;

  return {
    schedule: (spec) => native.schedule(spec),
    cancel: (key) => native.cancel(key),
    stop: (key) => native.stop(key),
    snooze: (key, minutes = 5) => native.snooze(key, minutes),
    reconcile: () => native.reconcile(),
    getSnapshot: () => native.getSnapshot(),
    getCapabilities: () => native.getCapabilities(),
    requestExactAlarmPermission: () => native.requestExactAlarmPermission(),
    requestNotificationPermission: () => native.requestNotificationPermission(),
    openNotificationSettings: () => native.openNotificationSettings(),
    openFullScreenIntentSettings: () => native.openFullScreenIntentSettings(),
  };
}

export const alarmRuntime: AlarmRuntime = createAlarmRuntime();
