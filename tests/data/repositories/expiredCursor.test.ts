import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PersistentAlarmRepository } from '../../../src/data/repositories/alarmRepository.ts';
import { DomainError } from '../../../src/domain/errors.ts';
import { page, response } from '../local/fixtures.ts';
import { setup } from './fakes.ts';

test('expired cursor restarts once without losing queued commands or duplicating native execution', async t => {
  const s = await setup(t); await s.repository.reconcile();
  const cursor = (await s.db.store.syncState('ana')).cursor;
  const command = { ...response('queued-after-expiry'), expectedDecisionRevision: 2 };
  await s.repository.enqueue(command);
  const before = await s.db.store.operations('ana');
  const calls: (string | null)[] = [];
  const repository = new PersistentAlarmRepository({ ...s.options, gateway: {
    async execute() { throw new DomainError('TEMPORARY_UNAVAILABLE', 'Temporary command transport failure'); },
    async sync(previous) {
      calls.push(previous);
      if (previous === cursor) throw new DomainError('EXPIRED', 'Cursor expired');
      assert.equal(previous, null);
      // This event was already applied during initial setup; replay is harmless.
      return page(s.record, 'initial', 'restarted-cursor');
    },
  } });
  await repository.reconcile();
  assert.deepEqual(calls, [cursor, null]);
  assert.equal((await s.db.store.syncState('ana')).cursor, 'restarted-cursor');
  assert.equal(s.runtime.scheduled.length, 1);
  assert.equal(s.runtime.cancelled.length, 0);
  const operations = await s.db.store.operations('ana');
  assert.deepEqual(operations.map(item => item.operationId).sort(), before.map(item => item.operationId).sort());
  assert.deepEqual(operations.find(item => item.operationId === command.operationId)!.command, command);
  assert.equal(operations.find(item => item.operationId === command.operationId)!.state, 'QUEUED');
  assert.equal(repository.getSnapshot().stale, false);
});

test('replayed feed after expiry still applies later revocations and cancels local alarms', async t => {
  const s = await setup(t); await s.repository.reconcile();
  const cursor = (await s.db.store.syncState('ana')).cursor;
  const calls: (string | null)[] = [];
  const repository = new PersistentAlarmRepository({ ...s.options, gateway: {
    execute: s.server.execute.bind(s.server),
    async sync(previous) {
      calls.push(previous);
      if (previous === cursor) throw new DomainError('EXPIRED', 'Cursor expired');
      if (previous === null) return { ...page(s.record, 'initial', 'replay-page'), hasMore: true };
      assert.equal(previous, 'replay-page');
      return { events: [{ kind: 'revoke' as const, eventId: 'after-expiry-revoke', groupId: s.record.groupId }],
        nextCursor: 'after-revoke', hasMore: false, serverTimeEpochMs: s.options.clock.nowEpochMs() };
    },
  } });
  await repository.reconcile();
  assert.deepEqual(calls, [cursor, null, 'replay-page']);
  assert.ok(s.runtime.cancelled.length > 0);
  assert.equal(s.runtime.scheduled.length, 1);
  assert.deepEqual(repository.getSnapshot().alarms, []);
  assert.deepEqual(repository.widgetSnapshot().groups, []);
});

test('a second expired cursor in the restarted feed fails boundedly and preserves known execution', async t => {
  const s = await setup(t); await s.repository.reconcile();
  const cursor = (await s.db.store.syncState('ana')).cursor;
  const calls: (string | null)[] = [];
  const repository = new PersistentAlarmRepository({ ...s.options, gateway: {
    execute: s.server.execute.bind(s.server),
    async sync(previous) {
      calls.push(previous);
      if (previous === null) return { ...page(s.record, 'initial', 'also-expired'), hasMore: true };
      throw new DomainError('EXPIRED', 'Cursor expired');
    },
  } });
  await assert.rejects(repository.reconcile(), { code: 'EXPIRED' });
  assert.deepEqual(calls, [cursor, null, 'also-expired']);
  assert.equal(s.runtime.cancelled.length, 0);
  assert.equal(s.runtime.scheduled.length, 1);
  assert.equal(repository.getSnapshot().stale, true);
});

test('ordinary synchronization errors never trigger cursor reset or delete local intent', async t => {
  const s = await setup(t); await s.repository.reconcile();
  const cursor = (await s.db.store.syncState('ana')).cursor;
  const calls: (string | null)[] = [];
  const repository = new PersistentAlarmRepository({ ...s.options, gateway: {
    execute: s.server.execute.bind(s.server),
    async sync(previous) { calls.push(previous); throw new DomainError('TEMPORARY_UNAVAILABLE', 'offline'); },
  } });
  await assert.rejects(repository.reconcile(), { code: 'TEMPORARY_UNAVAILABLE' });
  assert.deepEqual(calls, [cursor]);
  assert.equal((await s.db.store.syncState('ana')).cursor, cursor);
  assert.equal(s.runtime.cancelled.length, 0);
});
