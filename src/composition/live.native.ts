import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { startMobileServices } from '../bootstrap/startMobile.ts';
import { createAlarmRuntime } from '../platform/alarms/index.ts';
import { createNotificationRuntime, requestNotificationPermission } from '../platform/notifications/native.ts';
import { productWireCodec } from './wire.ts';
import { apiBaseUrlFromEnv } from '../config/api.ts';
import { createIdGenerator } from '../domain/ids.ts';
import { clearWidget, syncWidgetForSession } from '../widgets/publisher.ts';
import { WIDGET_SNAPSHOT_SCHEMA_VERSION, type WidgetSnapshot } from '../widgets/snapshot.ts';
import type { ProductBackend } from './backend.ts';
import type { DataSnapshot } from '../data/repositories/alarmRepository.ts';

export async function createLiveBackend(): Promise<ProductBackend> {
  let deviceId = await SecureStore.getItemAsync('alarmat.installation.v1');
  if (!deviceId) { deviceId = createIdGenerator().next('device'); await SecureStore.setItemAsync('alarmat.installation.v1', deviceId); }
  const deviceIdForUser = (userId: string) => `${deviceId}.${userId}`;
  const runtime = createAlarmRuntime(); const notificationRuntime = createNotificationRuntime();
  const client = await startMobileServices({
    baseUrl: apiBaseUrlFromEnv({ allowLocalHttp: __DEV__ }), allowLocalHttp: __DEV__, codec: productWireCodec, deviceId, deviceIdForUser, runtime, notificationRuntime,
    async publishWidget(snapshot) {
      if (!snapshot) { clearWidget(Date.now()); return; }
      const group = snapshot.groups[0]; if (!group) { clearWidget(Date.now()); return; }
      const scope = { userId: snapshot.userId, groupId: group.groupId };
      const widget: WidgetSnapshot = { schemaVersion: WIDGET_SNAPSHOT_SCHEMA_VERSION, scope, generatedAtEpochMs: snapshot.generatedAtEpochMs,
        nextAlarm: group.nextAlarm ? { requestId: group.nextAlarm.requestId, occurrenceId: group.nextAlarm.occurrenceId, title: group.nextAlarm.title, scheduledAtEpochMs: group.nextAlarm.effectiveAtEpochMs, mode: group.nextAlarm.mode } : null,
        counts: { pendingProposals: group.pendingProposals, pendingActivations: group.pendingActivation, withdrawalPending: group.cancelPending } };
      syncWidgetForSession(widget, scope, Date.now());
    },
  });
  let snapshot: DataSnapshot | null = null; let unsubscribeRepository: (() => void) | undefined;
  const listeners = new Set<() => void>(); const notify = () => { for (const listener of listeners) listener(); };
  client.subscribe(() => {
    unsubscribeRepository?.(); const repository = client.getRepository();
    if (!repository) { snapshot = null; notify(); return; }
    unsubscribeRepository = repository.subscribe(value => { snapshot = value; notify(); });
  });
  const registerInstallation = async () => { await client.request('/v1/devices', 'POST', { deviceId: deviceIdForUser(client.view().session!.userId), platform: Platform.OS === 'android' ? 'android' : 'ios' }); };
  return {
    initialize: () => client.initialize(), userId: () => client.view().session?.authenticated ? client.view().session!.userId : null,
    async authenticate(input, register) { await (register ? client.register(input) : client.login(input)); await registerInstallation(); },
    async logout() { await client.logout(); },
    request: (path, method, body) => client.request(path, method, body),
    async submit(command) { const repository = client.getRepository(); if (!repository) throw new Error('Inicia sesión para continuar.'); return repository.submit(command); },
    async reconcile() { await client.sync.reconcile(); },
    decorate(alarms) {
      return alarms.map(alarm => {
        const view = snapshot?.alarms.find(item => item.alarm.requestId === alarm.requestId && item.alarm.recipient.uid === snapshot?.userId);
        if (!view) return alarm;
        const operation = snapshot?.operations.filter(op => view.operationIds.includes(op.operationId)).at(-1);
        return { ...alarm, localStatus: view.scheduling, localEffectiveAtEpochMs: view.effectiveAtEpochMs, sync: operation?.state };
      });
    },
    cached() {
      const userId = client.view().session?.userId ?? '';
      return { userId, lastSync: snapshot?.lastSyncedAtEpochMs ?? null,
        alarms: (snapshot?.userId === userId ? snapshot.alarms : []).map(view => ({
          groupId: view.alarm.groupId, requestId: view.alarm.requestId, request: view.alarm.request,
          recipients: [view.alarm.recipient], schedules: view.alarm.schedules,
          localStatus: view.scheduling, localEffectiveAtEpochMs: view.effectiveAtEpochMs, sync: snapshot?.operations.filter(op => view.operationIds.includes(op.operationId)).at(-1)?.state,
        })) };
    },
    pending: () => snapshot?.operations.filter(op => op.state !== 'CONFIRMED').length ?? 0,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async makePrimaryDevice() { await registerInstallation(); await client.request('/v1/devices/primary', 'POST', { deviceId: deviceIdForUser(client.view().session!.userId) }); await client.sync.reconcile(); return 'Este móvil es ahora tu dispositivo principal. Los anteriores retirarán sus avisos al sincronizar.'; },
    async requestPermissions() {
      await requestNotificationPermission();
      let capabilities = await runtime.getCapabilities();
      if (!capabilities.exactAlarms) { await runtime.requestExactAlarmPermission(); capabilities = await runtime.getCapabilities(); }
      await client.sync.reconcile();
      return capabilities.exactAlarms && capabilities.notifications ? 'Permisos disponibles. Los avisos aceptados se activarán al sincronizar.' : 'Aún falta algún permiso. Revisa alarmas exactas y notificaciones en los ajustes de Android.';
    },
  };
}
