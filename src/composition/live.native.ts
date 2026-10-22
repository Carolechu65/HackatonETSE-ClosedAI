import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { startMobileServices } from '../bootstrap/startMobile.ts';
import { createAlarmRuntime } from '../platform/alarms/index.ts';
import { createAssignmentNotifications } from '../platform/notifications/assignments.native.ts';
import { createNotificationRuntime, requestNotificationPermission } from '../platform/notifications/native.ts';
import { productWireCodec } from './wire.ts';
import { apiBaseUrlFromEnv } from '../config/api.ts';
import { createIdGenerator } from '../domain/ids.ts';
import { clearWidget, syncWidgetForSession } from '../widgets/publisher.ts';
import { isValidWidgetTaskProjection, projectSelectedWidget, projectWidgetTasks, type WidgetTaskProjection } from './widgetProjection.ts';
import type { ProductBackend } from './backend.ts';
import type { DataSnapshot, PersistedWidgetSnapshot } from '../data/repositories/alarmRepository.ts';

export async function createLiveBackend(): Promise<ProductBackend> {
  let deviceId = await SecureStore.getItemAsync('alarmat.installation.v1');
  if (!deviceId) { deviceId = createIdGenerator().next('device'); await SecureStore.setItemAsync('alarmat.installation.v1', deviceId); }
  const deviceIdForUser = (userId: string) => `${deviceId}.${userId}`;
  const checkPublication = (result: ReturnType<typeof clearWidget>) => { if (!result.published && result.reason === 'native_error') throw new Error('No se pudo limpiar o actualizar el widget del dispositivo. Vuelve a intentarlo.'); };
  let selectedScope: { userId: string; groupId: string | null } | null = null;
  let widgetProjection: PersistedWidgetSnapshot | null = null;
  let taskProjection: WidgetTaskProjection | null = null;
  let publicationGeneration = 0;
  let pendingTaskCacheClearUserId: string | null = null;
  let taskCacheWrite: Promise<void> = Promise.resolve();
  const taskCacheKey = (userId: string) => `alarmat.widgetTasks.${userId}`;
  const publishSelectedWidget = (snapshot: PersistedWidgetSnapshot) => {
    const groupId = selectedScope?.userId === snapshot.userId ? selectedScope.groupId : null;
    if (selectedScope?.userId === snapshot.userId && groupId === null) { checkPublication(clearWidget(Date.now())); return; }
    const widget = projectSelectedWidget(snapshot, groupId, taskProjection);
    if (!widget) { checkPublication(clearWidget(Date.now())); return; }
    checkPublication(syncWidgetForSession(widget, widget.scope, Date.now(), { timeZone: taskProjection && taskProjection.snapshot.scope?.userId === widget.scope?.userId && taskProjection?.snapshot.scope?.groupId === widget.scope?.groupId ? taskProjection.timeZone : undefined }));
  };
  const runtime = createAlarmRuntime(); const notificationRuntime = createNotificationRuntime();
  const client = await startMobileServices({
    baseUrl: apiBaseUrlFromEnv({ allowLocalHttp: __DEV__ }), allowLocalHttp: __DEV__, codec: productWireCodec, deviceId, deviceIdForUser, runtime, notificationRuntime,
    async publishWidget(snapshot) {
      const expected = ++publicationGeneration;
      widgetProjection = snapshot;
      if (!snapshot) {
        const oldUserId = selectedScope?.userId ?? pendingTaskCacheClearUserId;
        pendingTaskCacheClearUserId = oldUserId ?? null;
        selectedScope = null; taskProjection = null;
        checkPublication(clearWidget(Date.now()));
        if (oldUserId) {
          taskCacheWrite = taskCacheWrite.catch(() => undefined).then(() => SecureStore.deleteItemAsync(taskCacheKey(oldUserId)));
          await taskCacheWrite;
          if (pendingTaskCacheClearUserId === oldUserId) pendingTaskCacheClearUserId = null;
        }
        return;
      }
      if (selectedScope?.userId !== snapshot.userId) {
        const [savedGroupId, savedTasks] = await Promise.all([
          SecureStore.getItemAsync(`alarmat.widgetGroup.${snapshot.userId}`),
          SecureStore.getItemAsync(taskCacheKey(snapshot.userId)),
        ]);
        if (expected !== publicationGeneration) return;
        taskProjection = null;
        try { const cached: unknown = savedTasks ? JSON.parse(savedTasks) : null;
          if (isValidWidgetTaskProjection(cached) && cached.snapshot.scope?.userId === snapshot.userId) taskProjection = cached;
        } catch { /* Corrupt private cache is discarded. */ }
        selectedScope = { userId: snapshot.userId,
          groupId: savedGroupId ?? snapshot.groups[0]?.groupId ?? taskProjection?.snapshot.scope?.groupId ?? null };
      }
      if (expected === publicationGeneration) publishSelectedWidget(snapshot);
    },
  });
  const assignments = createAssignmentNotifications({
    baseUrl: apiBaseUrlFromEnv({ allowLocalHttp: __DEV__ }),
    currentUserId: () => client.view().session?.authenticated ? client.view().session!.userId : null,
    request: (path, method, body) => client.request(path, method, body),
  });
  let widgetActionNotice: string | null = null;
  let snapshot: DataSnapshot | null = null; let unsubscribeRepository: (() => void) | undefined;
  const listeners = new Set<() => void>(); const notify = () => { for (const listener of listeners) listener(); };
  client.subscribe(() => {
    unsubscribeRepository?.(); const repository = client.getRepository();
    if (!repository) { snapshot = null; void assignments.clear().catch(() => undefined); notify(); return; }
    unsubscribeRepository = repository.subscribe(value => { snapshot = value; notify(); });
  });
  let registeredUserId: string | null = null;
  const registerInstallation = async () => { const userId = client.view().session!.userId; await client.request('/v1/devices', 'POST', { deviceId: deviceIdForUser(client.view().session!.userId), platform: Platform.OS === 'android' ? 'android' : 'ios' }); registeredUserId = userId; };
  return {
    cleanupPending: () => client.view().cleanupPending,
    async initialize() { await client.initialize(); await assignments.configure(); }, userId: () => client.view().session?.authenticated ? client.view().session!.userId : null,
    async authenticate(input, register) { await (register ? client.register(input) : client.login(input)); await registerInstallation(); await assignments.configure(); },
    async logout() { const userId = client.view().session?.userId ?? null; await Promise.all([client.logout(), assignments.clear(userId)]); registeredUserId = null; },
    request: (path, method, body) => client.request(path, method, body),
    async submit(command) { const repository = client.getRepository(); if (!repository) throw new Error('Inicia sesión para continuar.'); return repository.submit(command); },
    async reconcile() {
      if (client.view().session?.authenticated && registeredUserId !== client.view().session?.userId) await registerInstallation();
      await assignments.configure();
      widgetActionNotice = await assignments.consumeTasks() ?? widgetActionNotice;
      await client.sync.reconcile();
      await assignments.sync();
    },
    consumeNotice() { const notice = widgetActionNotice; widgetActionNotice = null; return notice; },
    async selectGroup(groupId) {
      const userId = client.view().session?.userId;
      if (!userId) return;
      ++publicationGeneration;
      selectedScope = { userId, groupId };
      if (groupId === null) { taskProjection = null; checkPublication(clearWidget(Date.now())); }
      else if (widgetProjection?.userId === userId) publishSelectedWidget(widgetProjection);
      else checkPublication(clearWidget(Date.now()));
      if (groupId === null) {
        taskCacheWrite = taskCacheWrite.catch(() => undefined).then(() => SecureStore.deleteItemAsync(taskCacheKey(userId)));
        await Promise.all([taskCacheWrite, SecureStore.deleteItemAsync(`alarmat.widgetGroup.${userId}`)]);
      }
      else await SecureStore.setItemAsync(`alarmat.widgetGroup.${userId}`, groupId);
    },
    async updateWidgetTasks(context) {
      if (client.view().session?.userId !== context.userId || selectedScope?.userId !== context.userId
        || selectedScope.groupId !== context.groupId) return;
      taskProjection = projectWidgetTasks(context);
      const serialized = JSON.stringify(taskProjection);
      taskCacheWrite = taskCacheWrite.catch(() => undefined).then(() => SecureStore.setItemAsync(taskCacheKey(context.userId), serialized));
      if (widgetProjection?.userId === context.userId) publishSelectedWidget(widgetProjection);
      else publishSelectedWidget({ schemaVersion: 1, userId: context.userId, generatedAtEpochMs: context.generatedAtEpochMs,
        lastSyncedAtEpochMs: context.generatedAtEpochMs, stale: false, groups: [] });
      await taskCacheWrite;
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
