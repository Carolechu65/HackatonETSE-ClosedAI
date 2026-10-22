import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { startMobileServices } from '../bootstrap/startMobile.ts';
import { createAlarmRuntime } from '../platform/alarms/index.ts';
import { createNotificationRuntime, requestNotificationPermission } from '../platform/notifications/native.ts';
import { productWireCodec } from './wire.ts';
import { apiBaseUrlFromEnv } from '../config/api.ts';
import { createIdGenerator } from '../domain/ids.ts';
import { clearWidget, syncWidgetForSession } from '../widgets/publisher.ts';
import { projectSelectedWidget } from './widgetProjection.ts';
import type { ProductBackend } from './backend.ts';
import type { DataSnapshot, PersistedWidgetSnapshot } from '../data/repositories/alarmRepository.ts';

export async function createLiveBackend(): Promise<ProductBackend> {
  let deviceId = await SecureStore.getItemAsync('alarmat.installation.v1');
  if (!deviceId) { deviceId = createIdGenerator().next('device'); await SecureStore.setItemAsync('alarmat.installation.v1', deviceId); }
  const deviceIdForUser = (userId: string) => `${deviceId}.${userId}`;
  const checkPublication = (result: ReturnType<typeof clearWidget>) => { if (!result.published && result.reason === 'native_error') throw new Error('No se pudo limpiar o actualizar el widget del dispositivo. Vuelve a intentarlo.'); };
  let selectedScope: { userId: string; groupId: string | null } | null = null;
  let widgetProjection: PersistedWidgetSnapshot | null = null;
  const publishSelectedWidget = (snapshot: PersistedWidgetSnapshot) => {
    const groupId = selectedScope?.userId === snapshot.userId ? selectedScope.groupId : null;
    const widget = projectSelectedWidget(snapshot, groupId);
    if (!widget) { checkPublication(clearWidget(Date.now())); return; }
    checkPublication(syncWidgetForSession(widget, widget.scope, Date.now()));
  };
  const runtime = createAlarmRuntime(); const notificationRuntime = createNotificationRuntime();
  const client = await startMobileServices({
    baseUrl: apiBaseUrlFromEnv({ allowLocalHttp: __DEV__ }), allowLocalHttp: __DEV__, codec: productWireCodec, deviceId, deviceIdForUser, runtime, notificationRuntime,
    async publishWidget(snapshot) {
      widgetProjection = snapshot;
      if (!snapshot) { selectedScope = null; checkPublication(clearWidget(Date.now())); return; }
      if (selectedScope?.userId !== snapshot.userId) {
        const groupId = await SecureStore.getItemAsync(`alarmat.widgetGroup.${snapshot.userId}`);
        selectedScope = { userId: snapshot.userId, groupId };
      }
      publishSelectedWidget(snapshot);
    },
  });
  let snapshot: DataSnapshot | null = null; let unsubscribeRepository: (() => void) | undefined;
  const listeners = new Set<() => void>(); const notify = () => { for (const listener of listeners) listener(); };
  client.subscribe(() => {
    unsubscribeRepository?.(); const repository = client.getRepository();
    if (!repository) { snapshot = null; notify(); return; }
    unsubscribeRepository = repository.subscribe(value => { snapshot = value; notify(); });
  });
  let registeredUserId: string | null = null;
  const registerInstallation = async () => { const userId = client.view().session!.userId; await client.request('/v1/devices', 'POST', { deviceId: deviceIdForUser(client.view().session!.userId), platform: Platform.OS === 'android' ? 'android' : 'ios' }); registeredUserId = userId; };
  return {
    cleanupPending: () => client.view().cleanupPending,
    async initialize() { await client.initialize(); }, userId: () => client.view().session?.authenticated ? client.view().session!.userId : null,
    async authenticate(input, register) { await (register ? client.register(input) : client.login(input)); await registerInstallation(); },
    async logout() { await client.logout(); registeredUserId = null; },
    request: (path, method, body) => client.request(path, method, body),
    async submit(command) { const repository = client.getRepository(); if (!repository) throw new Error('Inicia sesión para continuar.'); return repository.submit(command); },
    async reconcile() { if (client.view().session?.authenticated && registeredUserId !== client.view().session?.userId) await registerInstallation(); await client.sync.reconcile(); },
    async selectGroup(groupId) {
      const userId = client.view().session?.userId;
      if (!userId) return;
      selectedScope = { userId, groupId };
      if (widgetProjection?.userId === userId) publishSelectedWidget(widgetProjection);
      await SecureStore.setItemAsync(`alarmat.widgetGroup.${userId}`, groupId);
    },
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
      const notificationCapabilities = await notificationRuntime.getCapabilities();
      return capabilities.exactAlarms && capabilities.notifications && notificationCapabilities.notifications ? 'Permisos disponibles. Los avisos aceptados se activarán al sincronizar.' : 'Aún falta algún permiso. Revisa alarmas exactas y notificaciones en los ajustes de Android.';
    },
  };
}
