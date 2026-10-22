import type { NativeAlarmControls } from './index.ts';

export class AlarmRuntimeNotImplementedError extends Error {
  readonly code = 'E_NOT_IMPLEMENTED';

  constructor() {
    super('El runtime Android no está instalado. Usa una development build, no Expo Go.');
    this.name = 'AlarmRuntimeNotImplementedError';
  }
}

/** Arranque seguro sin módulo nativo. No simula éxito ni solicita permisos. */
export const unavailableAlarmRuntime: NativeAlarmControls = {
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

