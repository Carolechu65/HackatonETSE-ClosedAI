import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AlarmGateway } from '../../../src/data/model.ts';
import type { AlarmCommand, OperationReceipt } from '../../../src/domain/contracts/types.ts';
import { DomainError, type AppErrorCode } from '../../../src/domain/errors.ts';
import { OutboxWorker } from '../../../src/platform/sync/outbox.ts';
import { openTestStore } from '../sqliteTestDatabase.ts';
import { page, response, scheduleAndAck } from './fixtures.ts';

function receipt(command: AlarmCommand): OperationReceipt {
  return { operationId: command.operationId, status: 'APPLIED', serverTimeEpochMs: 1000, requestVersion: 1, decisionRevision: 2 };
}
function gateway(execute: AlarmGateway['execute']): AlarmGateway {
  return { execute, async sync() { throw new Error('outbox must not sync'); } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test('single flight shares promise; two senders cannot claim the same operation', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  await db.store.enqueue('ana', 'respondToAlarm', response(), 1);
  const started = deferred<void>(); const complete = deferred<OperationReceipt>();
  let calls = 0;
  const options = { userId: 'ana', store: db.store, clock: { nowEpochMs: () => 1000 }, assertCurrent() {},
    gateway: gateway(async () => { calls++; started.resolve(); return complete.promise; }) };
  const worker = new OutboxWorker(options);
  const first = worker.flush();
  assert.strictEqual(worker.flush(), first);
  await started.promise;
  await new OutboxWorker(options).flush();
  assert.equal(calls, 1);
  complete.resolve(receipt(response())); await first;
  assert.equal((await db.store.operations('ana'))[0]!.state, 'CONFIRMED');
  assert.equal((await db.store.operations('ana'))[0]!.attempts, 1);
});

test('backoff honors jitter, exponential attempts and retryAfter without bypassing same-entity FIFO', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  await db.store.enqueue('ana', 'respondToAlarm', response('disable', 'DISABLED'), 0);
  await db.store.enqueue('ana', 'respondToAlarm', response('accept'), 0);
  await db.store.enqueue('ana', 'respondToAlarm', { ...response('other'), entityId: 'req-002' }, 0);
  let now = 1000; let failures = 0; const calls: string[] = [];
  const worker = new OutboxWorker({ userId: 'ana', store: db.store, clock: { nowEpochMs: () => now }, assertCurrent() {}, random: () => 0,
    gateway: gateway(async (_kind, command) => {
      calls.push(command.operationId);
      if (command.operationId === 'disable' && failures++ < 2) throw new DomainError('RATE_LIMITED', 'wait', failures === 1 ? undefined : { retryAfterMs: 4000 });
      return receipt(command);
    }) });
  await worker.flush();
  assert.deepEqual(calls, ['disable', 'other']);
  assert.equal((await db.store.operations('ana'))[0]!.nextAttemptAt, 1500);
  now = 1499; await worker.flush(); assert.equal(calls.length, 2);
  now = 1500; await worker.flush();
  assert.equal((await db.store.operations('ana'))[0]!.nextAttemptAt, 5500);
  now = 5500; await worker.flush();
  assert.deepEqual(calls, ['disable', 'other', 'disable', 'disable', 'accept']);
  assert.equal((await db.store.operations('ana'))[0]!.attempts, 3);
});

test('jitter upper bound and retry cap stop transient failures at max attempts', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  await db.store.enqueue('ana', 'respondToAlarm', response(), 0);
  let now = 1000;
  const worker = new OutboxWorker({ userId: 'ana', store: db.store, clock: { nowEpochMs: () => now }, assertCurrent() {}, random: () => 1, maxAttempts: 2,
    gateway: gateway(async () => { throw new Error('network unavailable'); }) });
  await worker.flush();
  assert.equal((await db.store.operations('ana'))[0]!.nextAttemptAt, 2500);
  now = 2500; await worker.flush();
  const operation = (await db.store.operations('ana'))[0]!;
  assert.equal(operation.state, 'FAILED_PERMANENT'); assert.equal(operation.attempts, 2);
  now = 100_000; await worker.flush();
  assert.equal((await db.store.operations('ana'))[0]!.attempts, 2);
});

for (const code of ['FORBIDDEN', 'NOT_FOUND', 'INVALID_ARGUMENT', 'EXPIRED', 'DEVICE_NOT_PRIMARY', 'VERSION_CONFLICT'] satisfies AppErrorCode[]) {
  test(`${code} is terminal and never silently overwrites the queued command`, async t => {
    const db = await openTestStore(); t.after(db.cleanup);
    const command = response(); await db.store.enqueue('ana', 'respondToAlarm', command, 0);
    let calls = 0;
    const worker = new OutboxWorker({ userId: 'ana', store: db.store, clock: { nowEpochMs: () => 1000 }, assertCurrent() {},
      gateway: gateway(async () => { calls++; throw new DomainError(code, 'rejected'); }) });
    await worker.flush(); await worker.flush();
    const operation = (await db.store.operations('ana'))[0]!;
    assert.equal(operation.state, code === 'VERSION_CONFLICT' ? 'CONFLICT' : 'FAILED_PERMANENT');
    assert.equal(operation.errorCode, code); assert.deepEqual(operation.command, command); assert.equal(calls, 1);
  });
}

test('401 suspends the drain and preserves commands for authenticated retry', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  await db.store.enqueue('ana', 'respondToAlarm', response('first'), 0);
  await db.store.enqueue('ana', 'respondToAlarm', { ...response('second'), entityId: 'req-002' }, 0);
  let authenticated = false; const calls: string[] = [];
  const worker = new OutboxWorker({ userId: 'ana', store: db.store, clock: { nowEpochMs: () => 1000 }, assertCurrent() {},
    gateway: gateway(async (_kind, command) => { calls.push(command.operationId); if (!authenticated) throw new DomainError('UNAUTHENTICATED', 'expired'); return receipt(command); }) });
  await assert.rejects(worker.flush(), { code: 'UNAUTHENTICATED' });
  assert.deepEqual(calls, ['first']);
  assert.deepEqual((await db.store.operations('ana')).map(item => item.state), ['QUEUED', 'QUEUED']);
  authenticated = true; await worker.flush();
  assert.deepEqual(calls, ['first', 'first', 'second']);
});

test('late response after account change cannot confirm old-account work', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  await db.store.enqueue('ana', 'respondToAlarm', response(), 0);
  await db.store.enqueue('luis', 'respondToAlarm', response(), 0);
  let current = true;
  const started = deferred<void>(); const complete = deferred<OperationReceipt>();
  const worker = new OutboxWorker({ userId: 'ana', store: db.store, clock: { nowEpochMs: () => 1000 },
    assertCurrent() { if (!current) throw new DomainError('UNAUTHENTICATED', 'switched'); },
    gateway: gateway(async () => { started.resolve(); return complete.promise; }) });
  const flight = worker.flush(); await started.promise;
  current = false; complete.resolve(receipt(response()));
  await assert.rejects(flight, { code: 'UNAUTHENTICATED' });
  assert.equal((await db.store.operations('ana'))[0]!.state, 'QUEUED');
  assert.equal((await db.store.operations('ana'))[0]!.receipt, undefined);
  assert.equal((await db.store.operations('luis'))[0]!.attempts, 0);
});

test('late response after revocation cannot resurrect the revoked operation', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  await db.store.enqueue('ana', 'respondToAlarm', response(), 0);
  const started = deferred<void>(); const complete = deferred<OperationReceipt>();
  const worker = new OutboxWorker({ userId: 'ana', store: db.store, clock: { nowEpochMs: () => 1000 }, assertCurrent() {},
    gateway: gateway(async () => { started.resolve(); return complete.promise; }) });
  const flight = worker.flush(); await started.promise;
  await db.store.applyPage('ana', { ...page(), events: [{ eventId: 'revoked-in-flight', kind: 'revoke', groupId: 'piso-demo', requestId: 'req-001' }] });
  complete.resolve(receipt(response())); await flight;
  const operation = (await db.store.operations('ana'))[0]!;
  assert.equal(operation.state, 'FAILED_PERMANENT');
  assert.equal(operation.errorCode, 'FORBIDDEN');
  assert.equal(operation.receipt, undefined);
});

test('receipt belonging to another operation is rejected and command lane precedes ACK lane', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  const { schedule, ack } = scheduleAndAck();
  await db.store.saveSchedule('ana', schedule, ack);
  await db.store.enqueue('ana', 'respondToAlarm', response(), 0);
  const calls: string[] = [];
  const worker = new OutboxWorker({ userId: 'ana', store: db.store, clock: { nowEpochMs: () => 1000 }, assertCurrent() {},
    gateway: gateway(async (_kind, command) => { calls.push(command.operationId); return { ...receipt(command), operationId: command.operationId === 'accept' ? 'unrelated' : command.operationId }; }) });
  await worker.flush();
  assert.deepEqual(calls, ['accept', ack.operationId]);
  assert.equal((await db.store.operations('ana')).find(item => item.operationId === 'accept')!.state, 'FAILED_PERMANENT');
  assert.equal((await db.store.operations('ana')).find(item => item.operationId === ack.operationId)!.state, 'CONFIRMED');
});
