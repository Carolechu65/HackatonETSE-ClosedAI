import { DomainError } from '../../domain/errors.ts';
import { isSafeLinkId } from '../../widgets/links.ts';

export type AssignmentNotice = {
  id: string; kind: 'alarm' | 'task'; entityId: string; groupId: string; version: number; title: string; body: string;
};
export function parseAssignments(value: unknown): AssignmentNotice[] {
  const entries = (value as { assignments?: unknown } | null)?.assignments;
  if (!Array.isArray(entries) || entries.length > 1000) throw new DomainError('INVALID_ARGUMENT', 'La lista de avisos no es válida.');
  return entries.map(entry => {
    const notice = entry as AssignmentNotice;
    if (!notice || typeof notice.id !== 'string' || !/^[A-Za-z0-9_:-]{1,256}$/.test(notice.id)
      || !['alarm', 'task'].includes(notice.kind) || !isSafeLinkId(notice.entityId) || !isSafeLinkId(notice.groupId)
      || !Number.isSafeInteger(notice.version) || notice.version < 1
      || typeof notice.title !== 'string' || notice.title.length > 200
      || typeof notice.body !== 'string' || notice.body.length > 1000) throw new DomainError('INVALID_ARGUMENT', 'El aviso recibido no es válido.');
    return { id: notice.id, kind: notice.kind, entityId: notice.entityId, groupId: notice.groupId,
      version: notice.version, title: notice.title, body: notice.body };
  });
}

export type WidgetTaskAction = {
  id: string; userId: string; groupId: string; taskId: string; expectedVersion: number;
  status: 'completed' | 'pending'; createdAtEpochMs: number;
};
export interface WidgetTaskQueue {
  peekWidgetTaskActions(): Promise<unknown[]>;
  ackWidgetTaskAction(id: string): Promise<boolean>;
  clearWidgetTaskActions(userId: string): Promise<boolean>;
}
export function isWidgetTaskAction(value: unknown): value is WidgetTaskAction {
  const row = value as WidgetTaskAction;
  return !!row && isSafeLinkId(row.id) && isSafeLinkId(row.userId) && isSafeLinkId(row.groupId)
    && isSafeLinkId(row.taskId) && Number.isSafeInteger(row.expectedVersion) && row.expectedVersion > 0
    && (row.status === 'completed' || row.status === 'pending')
    && Number.isSafeInteger(row.createdAtEpochMs) && row.createdAtEpochMs >= 0;
}

/** The server remains authority; a widget tap is a durable, versioned request, never optimistic completion. */
export async function consumeWidgetTaskActions(options: {
  queue: WidgetTaskQueue; userId: string; currentUserId(): string | null;
  request(path: string, method: 'POST', body: unknown): Promise<unknown>;
}): Promise<string | null> {
  let warning: string | null = null;
  for (const value of (await options.queue.peekWidgetTaskActions()).slice(0, 100)) {
    if (options.currentUserId() !== options.userId) break;
    if (!isWidgetTaskAction(value)) {
      const id = (value as { id?: unknown } | null)?.id;
      if (isSafeLinkId(id)) await options.queue.ackWidgetTaskAction(id);
      continue;
    }
    if (value.userId !== options.userId) continue;
    try {
      await options.request(`/v1/groups/${value.groupId}/tasks/${value.taskId}`, 'POST', {
        status: value.status, expectedVersion: value.expectedVersion, operationId: value.id,
      });
      await options.queue.ackWidgetTaskAction(value.id);
    } catch (error) {
      if (!(error instanceof DomainError) || error.code === 'TEMPORARY_UNAVAILABLE' || error.code === 'RATE_LIMITED') throw error;
      if (error.code === 'UNAUTHENTICATED') throw error;
      await options.queue.ackWidgetTaskAction(value.id);
      warning = error.code === 'VERSION_CONFLICT'
        ? 'La tarea cambió desde la última lectura del widget. Revisa su estado antes de marcarla de nuevo.'
        : 'No se pudo cambiar la tarea desde el widget. Abre su detalle para revisar la asignación.';
    }
  }
  return warning;
}

/** Serialize private native state; clearing invalidates even a SecureStore read still in flight. */
export function createAssignmentLifecycle<Session extends { userId: string }>(ports: {
  currentUserId(): string | null;
  configure(session: Session): Promise<unknown>;
  sync(userId: string, assignments: AssignmentNotice[]): Promise<unknown>;
  clear(userId: string): Promise<unknown>;
}) {
  let generation = 0;
  let owner: string | null = null;
  const pendingCleanup = new Set<string>();
  let writes: Promise<unknown> = Promise.resolve();
  const enqueue = (action: () => Promise<unknown>) => {
    const result = writes.catch(() => undefined).then(action);
    writes = result;
    return result;
  };
  return {
    async configure(userId: string, load: () => Promise<Session | null>) {
      const expected = generation;
      owner = userId;
      const session = await load();
      if (!session || session.userId !== userId || expected !== generation || ports.currentUserId() !== userId) return;
      await enqueue(async () => {
        if (expected !== generation || ports.currentUserId() !== userId) return;
        await ports.configure(session);
        // If authentication disappears without a cleanup callback, also remove the secret.
        if (ports.currentUserId() !== userId) await ports.clear(userId);
      });
    },
    async sync(userId: string, load: () => Promise<AssignmentNotice[]>) {
      const expected = generation;
      const assignments = await load();
      await enqueue(async () => {
        if (expected !== generation || ports.currentUserId() !== userId) return;
        await ports.sync(userId, assignments);
      });
    },
    clear(userId?: string | null): Promise<unknown> {
      ++generation;
      const target = userId ?? owner;
      if (target) pendingCleanup.add(target);
      if (owner === target) owner = null;
      return enqueue(async () => {
        for (const previousUserId of [...pendingCleanup]) {
          await ports.clear(previousUserId);
          pendingCleanup.delete(previousUserId);
        }
      });
    },
  };
}
