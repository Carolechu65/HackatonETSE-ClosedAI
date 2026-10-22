import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openTestStore } from '../data/sqliteTestDatabase.ts';
import { alarm, page, response, scheduleAndAck } from '../data/local/fixtures.ts';
import { OutboxWorker } from '../../src/platform/sync/outbox.ts';
import type { AlarmCommand, OperationReceipt } from '../../src/domain/contracts/types.ts';
import type { AlarmGateway } from '../../src/data/model.ts';
import { DomainError } from '../../src/domain/errors.ts';
const receipt = (command: AlarmCommand): OperationReceipt => ({ operationId: command.operationId, status: 'APPLIED', serverTimeEpochMs: 1000 });
function worker(store: Awaited<ReturnType<typeof openTestStore>>['store'], execute: AlarmGateway['execute']) {
  return new OutboxWorker({ userId: 'ana', store, gateway: { execute, async sync() { throw new Error('unused'); } },
    clock: { nowEpochMs: () => 10000 }, assertCurrent() {}, maxAttempts: 1 });
}
for (const change of ['request', 'decision', 'device', 'epoch', 'no-device'] as const) {
  test(`feed ${change} invalidates old queued ACK without rewriting a user command`, async t => {
    const db = await openTestStore(); t.after(db.cleanup);
    const initial = alarm(); initial.recipient.decisionRevision = 1;
    await db.store.applyPage('ana', page(initial));
    const { ack, schedule } = scheduleAndAck(); await db.store.saveSchedule('ana', schedule, ack);
    await db.store.enqueue('ana', 'respondToAlarm', response('user-command'), 0);
    const updated = JSON.parse(JSON.stringify(initial)) as typeof initial;
    if (change === 'request') updated.request.requestVersion++;
    if (change === 'decision') updated.recipient.decisionRevision++;
    if (change === 'device') updated.primaryDevice!.deviceId = 'other-device';
    if (change === 'epoch') updated.primaryDevice!.deviceEpoch++;
    if (change === 'no-device') updated.primaryDevice = null;
    await db.store.applyPage('ana', page(updated, 'new-event', 'new-cursor'));
    const calls: string[] = [];
    await worker(db.store, async (_, command) => { calls.push(command.operationId); return receipt(command); }).flush();
    assert.deepEqual(calls, ['user-command']);
    const old = (await db.store.operations('ana')).find(op => op.operationId === ack.operationId)!;
    assert.equal(old.state, 'FAILED_PERMANENT'); assert.deepEqual(old.command, ack);
    assert.equal(old.errorCode, change === 'request' || change === 'decision' ? 'VERSION_CONFLICT' : 'DEVICE_NOT_PRIMARY');
  });
}

test('in-flight ACK invalidation cannot be undone by a late server receipt', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  const initial = alarm(); initial.recipient.decisionRevision = 1; await db.store.applyPage('ana', page(initial));
  const { ack, schedule } = scheduleAndAck(); await db.store.saveSchedule('ana', schedule, ack);
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  let release!: (receipt: OperationReceipt) => void; const pending = new Promise<OperationReceipt>(resolve => { release = resolve; });
  const flush = worker(db.store, async () => { entered(); return pending; }).flush(); await started;
  initial.primaryDevice!.deviceEpoch = 2; await db.store.applyPage('ana', page(initial, 'epoch-event', 'epoch-cursor'));
  release(receipt(ack)); await flush;
  const operation = (await db.store.operations('ana'))[0]!;
  assert.equal(operation.state, 'FAILED_PERMANENT'); assert.equal(operation.errorCode, 'DEVICE_NOT_PRIMARY'); assert.equal(operation.receipt, undefined);
});

for (const code of ['TEMPORARY_UNAVAILABLE', 'RATE_LIMITED'] as const) {
  test(`explicit retry of exhausted ${code} preserves ID and byte-equivalent command`, async t => {
    const db = await openTestStore(); t.after(db.cleanup);
    const command = response('stable-user-op'); await db.store.enqueue('ana', 'respondToAlarm', command, 0);
    await worker(db.store, async () => { throw new DomainError(code, 'retry later'); }).flush();
    const old = (await db.store.operations('ana'))[0]!;
    const retried = await db.store.retryTransientOperation('ana', command.operationId, 1234);
    assert.equal(retried.operationId, old.operationId); assert.deepEqual(retried.command, old.command);
    assert.equal(retried.attempts, 0); assert.equal(retried.state, 'QUEUED'); assert.equal(retried.nextAttemptAt, 1234);
    assert.equal(retried.errorCode, undefined);
    await worker(db.store, async (_, command) => receipt(command)).flush();
    assert.equal((await db.store.operations('ana'))[0]!.state, 'CONFIRMED');
  });
}

for (const code of ['VERSION_CONFLICT', 'INVALID_ARGUMENT', 'FORBIDDEN'] as const) {
  test(`explicit retry never resets ${code}`, async t => {
    const db = await openTestStore(); t.after(db.cleanup);
    await db.store.enqueue('ana', 'respondToAlarm', response('terminal'), 0);
    await worker(db.store, async () => { throw new DomainError(code, 'permanent'); }).flush();
    const old = (await db.store.operations('ana'))[0]!;
    await assert.rejects(db.store.retryTransientOperation('ana', 'terminal', 10000), { code: 'INVALID_ARGUMENT' });
    assert.deepEqual((await db.store.operations('ana'))[0], old);
  });
}

test('an exhausted transient ACK cannot be manually revived after its device changed', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  const initial = alarm(); initial.recipient.decisionRevision = 1; await db.store.applyPage('ana', page(initial));
  const { ack, schedule } = scheduleAndAck(); await db.store.saveSchedule('ana', schedule, ack);
  await worker(db.store, async () => { throw new DomainError('TEMPORARY_UNAVAILABLE', 'network'); }).flush();
  initial.primaryDevice!.deviceEpoch++; await db.store.applyPage('ana', page(initial, 'new-epoch', 'new-cursor'));
  await assert.rejects(db.store.retryTransientOperation('ana', ack.operationId, 10000), { code: 'DEVICE_NOT_PRIMARY' });
});
