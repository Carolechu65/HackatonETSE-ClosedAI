import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { openDatabaseAsync } from 'expo-sqlite';
import type { AlarmRuntime } from '../alarms/index.ts';
import { unavailableAlarmRuntime } from '../alarms/index.ts';
import type { NotificationControls } from './index.ts';
import { unavailableNotifications } from './index.ts';
import { notificationRuntime, type NotificationDriver, type NotificationRecord } from './runtime.ts';

const PROPOSALS = 'alarmat-proposals-v1';
const REMINDERS = 'alarmat-reminders-v1';
let configured = false;
async function configure(): Promise<void> {
  if (configured) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(PROPOSALS, { name: 'Propuestas de aviso', importance: Notifications.AndroidImportance.DEFAULT });
    await Notifications.setNotificationChannelAsync(REMINDERS, { name: 'Recordatorios aceptados', importance: Notifications.AndroidImportance.HIGH, sound: 'default' });
  }
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
  configured = true;
}
async function permission(channel: string): Promise<boolean> {
  await configure();
  if (!(await Notifications.getPermissionsAsync()).granted) return false;
  if (Platform.OS !== 'android') return true;
  return (await Notifications.getNotificationChannelAsync(channel))?.importance !== Notifications.AndroidImportance.NONE;
}

/** UI only. Does not run during sync or scheduling. No remote push listener is installed. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  await configure();
  return (await Notifications.requestPermissionsAsync()).granted;
}

export function createNotifications(): NotificationControls {
  if (Platform.OS === 'web') return unavailableNotifications;
  return {
    requestPermission: requestNotificationPermission,
    async openSettings() { try { await Linking.openSettings(); return true; } catch { return false; } },
    async getPermission() {
      const p = await Notifications.getPermissionsAsync();
      if (p.granted) return await permission(PROPOSALS) ? 'GRANTED' : 'DENIED';
      return p.status === 'undetermined' ? 'UNDETERMINED' : 'DENIED';
    },
    async showProposal(proposal) {
      if (!await permission(PROPOSALS)) throw Object.assign(new Error('Habilita notificaciones para ver las propuestas.'), { code: 'PENDING_PERMISSION' });
      await Notifications.scheduleNotificationAsync({
        identifier: `alarmat-proposal:${proposal.requestId}`,
        content: { title: proposal.title, body: 'Abre la propuesta para decidir si quieres activar el aviso.', data: { kind: 'proposal', ...proposal, url: `/alarm/${encodeURIComponent(proposal.requestId)}` } },
        trigger: { channelId: PROPOSALS },
      });
    },
    async dismissProposal(id) {
      await Notifications.cancelScheduledNotificationAsync(`alarmat-proposal:${id}`);
      await Notifications.dismissNotificationAsync(`alarmat-proposal:${id}`);
    },
  };
}

/** SQLite tracks intention; Expo owns delivery, independently of the native audible runtime. */
export function createNotificationRuntime(): AlarmRuntime {
  if (Platform.OS === 'web') return unavailableAlarmRuntime;
  const db = openDatabaseAsync('alarmat-notification-runtime.db').then(async database => {
    await database.execAsync('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL); INSERT OR IGNORE INTO meta VALUES(1,0);');
    return database;
  });
  const driver: NotificationDriver = {
    async read() {
      const database = await db;
      const rows = await database.getAllAsync<{ payload: string }>('SELECT payload FROM records');
      const revision = (await database.getFirstAsync<{ revision: number }>('SELECT revision FROM meta WHERE id=1'))!.revision;
      return { revision, records: rows.map(r => JSON.parse(r.payload) as NotificationRecord) };
    },
    async write(record) {
      const database = await db;
      await database.withTransactionAsync(async () => {
        await database.runAsync('INSERT OR REPLACE INTO records(id,payload) VALUES(?,?)', record.id, JSON.stringify(record));
        await database.runAsync('UPDATE meta SET revision=revision+1 WHERE id=1');
      });
    },
    permission: () => permission(REMINDERS),
    async schedule(id, spec) {
      await configure();
      await Notifications.scheduleNotificationAsync({ identifier: id, content: { title: spec.title, sound: 'default', data: { kind: 'accepted-reminder', requestId: spec.requestId, url: `/alarm/${encodeURIComponent(spec.requestId)}` } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(spec.effectiveAtEpochMs), channelId: REMINDERS } });
    },
    async cancel(id) { await Notifications.cancelScheduledNotificationAsync(id); await Notifications.dismissNotificationAsync(id); },
    async registered() { return new Set((await Notifications.getAllScheduledNotificationsAsync()).map(n => n.identifier)); },
    async presented() { return new Set((await Notifications.getPresentedNotificationsAsync()).map(n => n.request.identifier)); },
  };
  return notificationRuntime(driver);
}
