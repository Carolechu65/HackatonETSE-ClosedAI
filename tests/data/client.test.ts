import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDataClient, type DataClientOptions } from '../../src/data/client.ts';
import { LocalDatabase } from '../../src/data/local/database.ts';
import { LocalStore } from '../../src/data/local/store.ts';
import type { SecureStorage, AuthSession } from '../../src/data/remote/session.ts';
import type { HttpWireCodec } from '../../src/data/remote/gateway.ts';
import type { SyncPage } from '../../src/data/model.ts';
import type { PersistedWidgetSnapshot } from '../../src/data/repositories/alarmRepository.ts';
import { createDeterministicIdGenerator } from '../../src/domain/ids.ts';
import { sqliteAdapter } from './sqliteTestDatabase.ts';
import { NativeRuntime, deferred } from './repositories/fakes.ts';
import { alarm, page, response, scheduleAndAck } from './local/fixtures.ts';

const now = 1792701000000;
const codec: HttpWireCodec = {
  decodeSession: value => value as AuthSession,
  decodeMe: value => value as { userId: string },
  decodeSyncPage: value => value as SyncPage,
};
async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'alarmat-client-'));
  const path = join(directory, 'local.sqlite');
  let sql = sqliteAdapter(path);
  const values = new Map<string, string>();
  const storage: SecureStorage = {
    getItemAsync: async key => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async key => { values.delete(key); },
  };
  const runtime = new NativeRuntime();
  const widgets: (PersistedWidgetSnapshot | null)[] = [];
  let syncStatus = 200; let logoutStatus = 204;
  let syncPage: SyncPage = { events: [], nextCursor: 'cursor', hasMore: false, serverTimeEpochMs: now };
  const options: DataClientOptions = {
    database: sql, secureStorage: storage, baseUrl: 'https://api.example.test', codec, deviceId: 'dev-a1', runtime,
    notificationRuntime: runtime, clock: { nowEpochMs: () => now }, ids: createDeterministicIdGenerator(),
    publishWidget: async snapshot => { widgets.push(snapshot); },
    fetch: async (url, init) => {
      if (url.endsWith('/login') || url.endsWith('/register')) {
        const payload = JSON.parse(init.body as string) as { userId: string };
        return Response.json({ userId: payload.userId, token: `secret-${payload.userId}`, expiresAtEpochMs: now + 100_000 });
      }
      if (url.endsWith('/logout')) return new Response(null, { status: logoutStatus });
      if (url.includes('/v1/sync')) return Response.json(syncStatus === 200 ? syncPage : {}, { status: syncStatus });
      if (url.includes('/v1/operations/')) {
        const command = JSON.parse(init.body as string) as { operationId: string };
        return Response.json({ operationId: command.operationId, status: 'APPLIED', serverTimeEpochMs: now });
      }
      throw new Error('Unexpected test endpoint');
    },
  };
  let client = createDataClient(options);
  let store = new LocalStore(new LocalDatabase(sql));
  t.after(async () => { await sql.closeAsync(); await rm(directory, { recursive: true, force: true }); });
  return { get client() { return client; }, get store() { return store; }, options, values, runtime, widgets,
    setSyncStatus(status: number) { syncStatus = status; }, setLogoutStatus(status: number) { logoutStatus = status; },
    setPage(value: SyncPage) { syncPage = value; },
    async downgradeToV1() { await sql.execAsync('DROP TABLE account_owner; PRAGMA user_version=1'); },
    async reopen() {
      await sql.closeAsync(); sql = sqliteAdapter(path);
      client = createDataClient({ ...options, database: sql }); store = new LocalStore(new LocalDatabase(sql));
      await client.initialize();
    },
  };
}

test('factory initializes once, registers/authenticates and exposes safe session/repository ports', async t => {
  const ctx = await setup(t);
  await Promise.all([ctx.client.initialize(), ctx.client.restore()]);
  assert.equal(ctx.client.getRepository(), null);
  const observed: unknown[] = [];
  ctx.client.sessionEvents.subscribe(value => observed.push(value));
  await ctx.client.register({ userId: 'ana' });
  assert.equal(ctx.client.getRepository()?.getSnapshot().userId, 'ana');
  assert.equal(ctx.client.sessionEvents.view()?.authenticated, true);
  assert.equal(JSON.stringify(observed).includes('secret'), false);
  assert.equal(await ctx.store.accountOwner(), 'ana');
  await ctx.client.sync.reconcile();
  assert.equal(ctx.client.getRepository()?.getSnapshot().stale, false);
});

test('401 deactivates held repository; durable owner survives restart and blocks foreign login before token installation', async t => {
  const ctx = await setup(t);
  await ctx.client.login({ userId: 'ana' });
  const previous = ctx.client.getRepository()!;
  await previous.enqueue(response('durable', 'DISABLED'));
  ctx.setSyncStatus(401);
  await assert.rejects(ctx.client.sync.reconcile(), { code: 'UNAUTHENTICATED' });
  assert.equal(ctx.client.getRepository(), null);
  await assert.rejects(previous.enqueue(response('late', 'DISABLED')), { code: 'UNAUTHENTICATED' });
  assert.equal(ctx.values.size, 0);
  await ctx.reopen();
  assert.equal(ctx.client.view().accountOwner, 'ana');
  assert.equal(ctx.client.sessionEvents.view()?.authenticated, false);
  await assert.rejects(ctx.client.login({ userId: 'bob' }), { code: 'FORBIDDEN' });
  assert.equal(ctx.values.size, 0);
  assert.equal((await ctx.store.operations('ana')).length, 1);
  ctx.setSyncStatus(200);
  await ctx.client.login({ userId: 'ana' });
  assert.equal(ctx.client.getRepository()?.getSnapshot().operations.length, 1);
});

test('logout cancels native alarms and clears widget before another account; reports remote revocation uncertainty', async t => {
  const ctx = await setup(t);
  await ctx.client.login({ userId: 'ana' });
  const { schedule } = scheduleAndAck();
  await ctx.store.saveSchedule('ana', schedule);
  await ctx.runtime.schedule(schedule.spec);
  ctx.setLogoutStatus(503);
  assert.deepEqual(await ctx.client.logout(), { remoteRevoked: false });
  assert.equal(ctx.runtime.cancelled.length, 1);
  assert.equal(ctx.widgets.at(-1), null);
  assert.equal(await ctx.store.accountOwner(), null);
  assert.equal(ctx.values.size, 0);
  await ctx.client.login({ userId: 'bob' });
  assert.equal(ctx.client.getRepository()?.getSnapshot().userId, 'bob');
  assert.equal(ctx.client.getRepository()?.getSnapshot().alarms.length, 0);
});

test('failed cancellation persists cleanup and prevents reauthentication across restart until retried logout succeeds', async t => {
  const ctx = await setup(t);
  await ctx.client.login({ userId: 'ana' });
  const { schedule } = scheduleAndAck();
  await ctx.store.saveSchedule('ana', schedule); await ctx.runtime.schedule(schedule.spec);
  ctx.runtime.cancellationFails = true;
  await assert.rejects(ctx.client.logout(), /cancelaciones/);
  assert.equal(ctx.client.getRepository(), null);
  assert.equal(ctx.client.view().cleanupPending, true);
  assert.equal(await ctx.store.accountOwner(), 'ana');
  assert.equal((await ctx.store.schedules('ana'))[0]?.status, 'CANCEL_PENDING');
  await assert.rejects(ctx.client.login({ userId: 'bob' }), { code: 'FORBIDDEN' });
  await ctx.reopen();
  assert.equal(ctx.client.getRepository(), null);
  await assert.rejects(ctx.client.login({ userId: 'ana' }), { code: 'FORBIDDEN' });
  ctx.runtime.cancellationFails = false;
  assert.deepEqual(await ctx.client.logout(), { remoteRevoked: true });
  await ctx.client.login({ userId: 'bob' });
  assert.equal(await ctx.store.accountOwner(), 'bob');
});

test('restart recovers SENDING while repeated initialize does not reset an active claim', async t => {
  const ctx = await setup(t);
  await ctx.client.login({ userId: 'ana' });
  await ctx.store.enqueue('ana', 'respondToAlarm', response('sending'), now);
  await ctx.store.claim('ana', now);
  await ctx.client.initialize();
  assert.equal((await ctx.store.operations('ana'))[0]?.state, 'SENDING');
  await ctx.reopen();
  assert.equal((await ctx.store.operations('ana'))[0]?.state, 'QUEUED');
  assert.equal(ctx.client.getRepository()?.getSnapshot().operations[0]?.operationId, 'sending');
});

test('logout waits for an in-flight native schedule and cancels the committed occurrence before clearing account', async t => {
  const ctx = await setup(t);
  const record = alarm(); record.request.mode = 'ALARM'; ctx.setPage(page(record));
  const started = deferred<void>(); const release = deferred<void>();
  ctx.runtime.beforeSchedule = async () => { started.resolve(); await release.promise; };
  await ctx.client.login({ userId: 'ana' });
  const syncing = assert.rejects(ctx.client.sync.reconcile(), { code: 'UNAUTHENTICATED' });
  await started.promise;
  const closing = ctx.client.logout();
  assert.equal(ctx.client.getRepository(), null);
  await assert.rejects(ctx.client.login({ userId: 'bob' }), { code: 'FORBIDDEN' });
  release.resolve();
  await syncing; await closing;
  assert.ok(ctx.runtime.cancelled.length >= 1);
  assert.ok([...ctx.runtime.entries.values()].every(entry => entry.status === 'CANCELLED'));
  assert.equal(await ctx.store.accountOwner(), null);
});

test('clearUser only releases its own account binding', async t => {
  const ctx = await setup(t); await ctx.client.initialize();
  await ctx.store.bindAccount('ana');
  await ctx.store.clearUser('bob');
  assert.equal(await ctx.store.accountOwner(), 'ana');
  await assert.rejects(ctx.store.bindAccount('bob'), { code: 'FORBIDDEN' });
  await ctx.store.clearUser('ana'); await ctx.store.bindAccount('bob');
  assert.equal(await ctx.store.accountOwner(), 'bob');
});

test('migration v1 recovers the owner from durable data even when SecureStore is empty', async t => {
  const ctx = await setup(t); await ctx.client.initialize();
  await ctx.store.saveWidget('ana', { private: 'snapshot' });
  await ctx.downgradeToV1(); await ctx.reopen();
  assert.equal(await ctx.store.accountOwner(), 'ana');
  await assert.rejects(ctx.client.login({ userId: 'bob' }), { code: 'FORBIDDEN' });
  assert.equal(ctx.values.size, 0);
});

test('logout interrupts a delayed login before it can install the session or bind another owner', async t => {
  const ctx = await setup(t);
  const started = deferred<void>(); const release = deferred<Response>();
  ctx.options.fetch = async () => { started.resolve(); return release.promise; };
  // Construct after replacing the test transport; the client never exposes its auth transport to UI.
  const client = createDataClient(ctx.options);
  const loggingIn = assert.rejects(client.login({ userId: 'ana' }), { code: 'UNAUTHENTICATED' });
  await started.promise;
  const closing = client.logout();
  release.resolve(Response.json({ userId: 'ana', token: 'late-secret', expiresAtEpochMs: now + 1000 }));
  await loggingIn; await closing;
  assert.equal(client.getRepository(), null);
  assert.equal(ctx.values.size, 0);
  assert.equal(await ctx.store.accountOwner(), null);
});

test('SecureStore deletion failure leaves a durable logout barrier even after native cleanup completed', async t => {
  const ctx = await setup(t); await ctx.client.login({ userId: 'ana' });
  const remove = ctx.options.secureStorage.deleteItemAsync;
  ctx.options.secureStorage.deleteItemAsync = async () => {
    assert.equal(await ctx.store.accountOwner(), 'ana');
    assert.deepEqual(await ctx.store.pendingCleanup(), ['ana']);
    assert.equal((await ctx.store.operations('ana')).length, 0);
    throw new Error('storage unavailable');
  };
  await assert.rejects(ctx.client.logout(), /storage unavailable/);
  assert.equal(await ctx.store.accountOwner(), 'ana');
  assert.deepEqual(await ctx.store.pendingCleanup(), ['ana']);
  ctx.options.secureStorage.deleteItemAsync = remove;
  await ctx.reopen();
  assert.equal(ctx.client.getRepository(), null);
  assert.equal(ctx.client.view().cleanupPending, true);
  await ctx.client.logout();
  assert.equal(await ctx.store.accountOwner(), null);
  assert.equal(ctx.values.size, 0);
});
