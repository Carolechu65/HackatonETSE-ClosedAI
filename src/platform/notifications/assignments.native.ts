import { DomainError } from '../../domain/errors.ts';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as SecureStore from 'expo-secure-store';
import { validateSession, type AuthSession } from '../../data/remote/session.ts';
import { consumeWidgetTaskActions, createAssignmentLifecycle, parseAssignments, type AssignmentNotice, type WidgetTaskQueue } from './assignmentLogic.ts';

interface AssignmentRuntime extends WidgetTaskQueue {
  configureAssignmentNotifications(input: AuthSession & { baseUrl: string }): Promise<boolean>;
  clearAssignmentNotifications(userId: string): Promise<boolean>;
  syncAssignmentNotifications(input: { userId: string; assignments: AssignmentNotice[] }): Promise<boolean>;
}

/** Native foreground and background delivery share one dedup journal and notification IDs. */
export function createAssignmentNotifications(options: {
  baseUrl: string; currentUserId(): string | null;
  request(path: string, method?: 'GET' | 'POST', body?: unknown): Promise<unknown>;
}) {
  const native = requireOptionalNativeModule<AssignmentRuntime>('AlarmRuntime');
  const lifecycle = createAssignmentLifecycle<AuthSession>({
    currentUserId: options.currentUserId,
    configure: session => native?.configureAssignmentNotifications({ ...session, baseUrl: options.baseUrl }) ?? Promise.resolve(false),
    sync: (userId, assignments) => native?.syncAssignmentNotifications({ userId, assignments }) ?? Promise.resolve(false),
    async clear(userId) {
      await native?.clearAssignmentNotifications(userId);
      await native?.clearWidgetTaskActions(userId);
    },
  });
  let queueFlight: Promise<string | null> | null = null;
  return {
    async configure() {
      const userId = options.currentUserId();
      if (!native || !userId) return;
      await lifecycle.configure(userId, async () => {
        const encoded = await SecureStore.getItemAsync('alarmat.session.v1');
        if (!encoded || options.currentUserId() !== userId) return null;
        try { return validateSession(JSON.parse(encoded) as AuthSession, Date.now()); }
        catch { throw new DomainError('UNAUTHENTICATED', 'La sesión de notificaciones ha caducado. Inicia sesión de nuevo.'); }
      });
    },
    async sync() {
      const userId = options.currentUserId();
      if (!native || !userId) return;
      await lifecycle.sync(userId, async () => parseAssignments(await options.request('/v1/assignments')));
    },
    async consumeTasks() {
      const userId = options.currentUserId();
      if (!native || !userId) return null;
      if (queueFlight) return queueFlight;
      queueFlight = consumeWidgetTaskActions({ queue: native, userId, currentUserId: options.currentUserId,
        request: (path, method, body) => options.request(path, method, body) });
      try { return await queueFlight; } finally { queueFlight = null; }
    },
    clear: (userId?: string | null) => lifecycle.clear(userId),
  };
}
