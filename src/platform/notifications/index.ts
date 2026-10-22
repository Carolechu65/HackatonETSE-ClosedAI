import { alarmRuntime } from '../alarms';

/**
 * P4: permisos y presentación local.
 *
 * Los canales, la notificación de alarma y las acciones detener/posponer viven
 * en `modules/alarm-runtime` y funcionan sin JS. Los recordatorios estándar con
 * expo-notifications quedan pendientes de añadir esa dependencia; no se finge
 * que este puerto los programa.
 */
export interface ProposalNotification {
  groupId: string;
  requestId: string;
  requestVersion: number;
  title: string;
}

export interface NotificationPort {
  getPermission(): Promise<'GRANTED' | 'DENIED' | 'UNDETERMINED' | 'UNAVAILABLE'>;
  requestPermission(): Promise<boolean>;
  openSettings(): Promise<boolean>;
  showProposal(proposal: ProposalNotification): Promise<void>;
  dismissProposal(requestId: string): Promise<void>;
}

export const nativeNotificationPort: NotificationPort = {
  async getPermission() {
    const capabilities = await alarmRuntime.getCapabilities();
    if (!capabilities.available) return 'UNAVAILABLE';
    return capabilities.notifications ? 'GRANTED' : 'DENIED';
  },
  requestPermission() {
    return alarmRuntime.requestNotificationPermission();
  },
  openSettings() {
    return alarmRuntime.openNotificationSettings();
  },
  async showProposal() {
    throw Object.assign(
      new Error('Los recordatorios estándar requieren expo-notifications; el prototipo usa el runtime nativo.'),
      { code: 'E_STANDARD_REMINDERS_PENDING' },
    );
  },
  async dismissProposal() {
    // Sin presentación estándar todavía no hay nada que retirar.
  },
};

/** Compatibilidad con el scaffold anterior. */
export const unavailableNotifications = nativeNotificationPort;
