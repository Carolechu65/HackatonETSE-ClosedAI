import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError } from '../src/domain/errors.ts';
import { consumeWidgetTaskActions, parseAssignments, type WidgetTaskAction } from '../src/platform/notifications/assignmentLogic.ts';
import { assignmentDestination, prepareAssignmentNavigation } from '../src/platform/notifications/navigation.ts';
import { createProductController } from '../src/composition/controller.ts';
import type { ProductBackend } from '../src/composition/backend.ts';

const action: WidgetTaskAction = { id: 'widget-op-1', userId: 'ana', groupId: 'casa', taskId: 'pan', expectedVersion: 3, status: 'completed', createdAtEpochMs: 1000 };
function queue(rows: unknown[]) {
  const acknowledged: string[] = [];
  return { acknowledged, peekWidgetTaskActions: async () => rows,
    ackWidgetTaskAction: async (id: string) => { acknowledged.push(id); return true; }, clearWidgetTaskActions: async () => true };
}
test('widget queue sends versioned idempotent request and ignores another account', async () => {
  const q = queue([{ ...action, id: 'other', userId: 'luis' }, action]);
  const sent: unknown[] = [];
  await consumeWidgetTaskActions({ queue: q, userId: 'ana', currentUserId: () => 'ana',
    request: async (...args) => { sent.push(args); } });
  assert.deepEqual(sent, [['/v1/groups/casa/tasks/pan', 'POST', { status: 'completed', expectedVersion: 3, operationId: 'widget-op-1' }]]);
  assert.deepEqual(q.acknowledged, ['widget-op-1']);
});
test('widget queue conflict is acknowledged with notice; temporary failure remains retryable', async () => {
  const q = queue([action]);
  const notice = await consumeWidgetTaskActions({ queue: q, userId: 'ana', currentUserId: () => 'ana', request: async () => { throw new DomainError('VERSION_CONFLICT', 'changed'); } });
  assert.match(notice!, /cambió/); assert.deepEqual(q.acknowledged, ['widget-op-1']);
  const pending = queue([action]);
  await assert.rejects(consumeWidgetTaskActions({ queue: pending, userId: 'ana', currentUserId: () => 'ana', request: async () => { throw new DomainError('TEMPORARY_UNAVAILABLE', 'offline'); } }));
  assert.deepEqual(pending.acknowledged, []);
});
test('widget queue does not act after account switch or on malformed target', async () => {
  const q = queue([action]); let sent = 0;
  await consumeWidgetTaskActions({ queue: q, userId: 'ana', currentUserId: () => 'luis', request: async () => { sent++; } });
  const broken = queue([{ ...action, taskId: '../private' }]);
  await consumeWidgetTaskActions({ queue: broken, userId: 'ana', currentUserId: () => 'ana', request: async () => { sent++; } });
  assert.equal(sent, 0); assert.deepEqual(broken.acknowledged, ['widget-op-1']);
});
test('assignment feed validates titles and scoped IDs; taps cannot carry mutations', () => {
  const notice = { id: 'task:pan:3', kind: 'task', entityId: 'pan', groupId: 'casa', version: 3, title: 'Comprar pan', body: 'Luis te ha asignado una tarea.' };
  assert.deepEqual(parseAssignments({ assignments: [notice] }), [notice]);
  assert.throws(() => parseAssignments({ assignments: [{ ...notice, entityId: '../pan' }] }));
  assert.throws(() => parseAssignments({ assignments: [{ ...notice, body: 'a'.repeat(1001) }] }));
  assert.deepEqual(assignmentDestination(notice), { kind: 'task', entityId: 'pan', groupId: 'casa' });
  assert.equal(assignmentDestination({ ...notice, kind: 'complete' }), null);
});
test('assignment tap refreshes membership then selects correct household; revoked membership blocks', async () => {
  let allowed = true;
  const api: ProductBackend = { initialize: async () => {}, authenticate: async () => {}, logout: async () => {}, userId: () => 'ana',
    request: async path => {
      if (path === '/v1/groups') return { groups: (allowed ? ['a', 'b'] : ['a']).map(id => ({ id, name: id, timeZone: 'UTC', role: 'member' })) };
      if (path === '/v1/auth/me') return { user: { displayName: 'Ana' } };
      if (path.endsWith('/members')) return { members: [{ userId: 'ana', displayName: 'Ana', role: 'member' }] };
      if (path.endsWith('/alarms')) return { alarms: [] };
      if (path.endsWith('/tasks')) return { tasks: [] };
      throw new Error(path);
    },
    reconcile: async () => {}, submit: async () => { throw new Error('unused'); }, decorate: alarms => alarms,
    pending: () => 0, subscribe: () => () => {}, makePrimaryDevice: async () => '', requestPermissions: async () => '',
  };
  const client = createProductController(async () => api);
  await client.signIn({ email: 'ana@example.test', password: 'unused' }, false);
  assert.equal(await prepareAssignmentNavigation(client, { kind: 'task', entityId: 'pan', groupId: 'b' }), '/task/pan');
  assert.equal(client.getSnapshot().groupId, 'b'); allowed = false;
  await assert.rejects(prepareAssignmentNavigation(client, { kind: 'task', entityId: 'pan', groupId: 'b' }), /acceso/);
  await client.signOut();
  await assert.rejects(prepareAssignmentNavigation(client, { kind: 'task', entityId: 'pan', groupId: 'b' }), /sesión/);
});

import { createAssignmentLifecycle } from '../src/platform/notifications/assignmentLogic.ts';
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
test('logout waits for delayed native configure and clears it even while auth still appears active', async () => {
  const started = deferred<void>(); const release = deferred<void>();
  const calls: string[] = [];
  const lifecycle = createAssignmentLifecycle<{ userId: string }>({ currentUserId: () => 'ana',
    configure: async () => { started.resolve(); await release.promise; calls.push('configure'); },
    sync: async () => false, clear: async () => { calls.push('clear'); } });
  const configuring = lifecycle.configure('ana', async () => ({ userId: 'ana' }));
  await started.promise;
  const clearing = lifecycle.clear();
  release.resolve(); await Promise.all([configuring, clearing]);
  assert.deepEqual(calls, ['configure', 'clear']);
});
test('logout invalidates delayed credential loading; newer login survives after ordered cleanup', async () => {
  const credentials = deferred<{ userId: string }>();
  let user = 'ana'; const calls: string[] = [];
  const lifecycle = createAssignmentLifecycle<{ userId: string }>({ currentUserId: () => user,
    configure: async session => { calls.push(`configure:${session.userId}`); },
    sync: async () => false, clear: async uid => { calls.push(`clear:${uid}`); } });
  const old = lifecycle.configure('ana', () => credentials.promise);
  const clearing = lifecycle.clear('ana');
  user = 'luis'; const newer = lifecycle.configure('luis', async () => ({ userId: 'luis' }));
  credentials.resolve({ userId: 'ana' });
  await Promise.all([old, clearing, newer]);
  assert.deepEqual(calls, ['clear:ana', 'configure:luis']);
});
test('late notification response cannot publish after logout; denied permission is not a sync failure', async () => {
  const response = deferred<ReturnType<typeof parseAssignments>>(); let published = 0;
  const lifecycle = createAssignmentLifecycle<{ userId: string }>({ currentUserId: () => 'ana',
    configure: async () => true, clear: async () => true, sync: async () => { published++; return false; } });
  const syncing = lifecycle.sync('ana', () => response.promise); await lifecycle.clear('ana'); response.resolve([]); await syncing;
  assert.equal(published, 0);
  await assert.doesNotReject(lifecycle.sync('ana', async () => [])); assert.equal(published, 1);
});

test('failed native cleanup retains owner for retry after authenticated session disappears', async () => {
  let fail = true; const cleared: string[] = [];
  const lifecycle = createAssignmentLifecycle<{ userId: string }>({ currentUserId: () => 'ana',
    configure: async () => true, sync: async () => true,
    clear: async userId => { if (fail) throw new Error('temporary native cleanup failure'); cleared.push(userId); } });
  await lifecycle.configure('ana', async () => ({ userId: 'ana' }));
  await assert.rejects(lifecycle.clear('ana'));
  fail = false; await lifecycle.clear(null);
  assert.deepEqual(cleared, ['ana']);
});
