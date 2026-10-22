import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDatabase } from '../../../src/data/local/database.ts';
import { openTestStore, sqliteAdapter } from '../sqliteTestDatabase.ts';
import { alarm, page, response, scheduleAndAck } from './fixtures.ts';

test('migration creates v2 and refuses a future schema without changing it', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  assert.equal(await db.database.read(async sql => (await sql.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!.user_version), 2);
  await db.database.read(sql => sql.execAsync('PRAGMA user_version = 3'));
  await db.close();
  const future = new LocalDatabase(sqliteAdapter(db.path)); t.after(() => future.close());
  await assert.rejects(future.initialize(), /más reciente/);
  assert.equal(await future.read(async sql => (await sql.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!.user_version), 3);
});

test('failed migration rolls all DDL back and can subsequently initialize', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'alarmat-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sql = sqliteAdapter(join(directory, 'test.sqlite'));
  let fail = true;
  const database = new LocalDatabase({ ...sql, async execAsync(statement) {
    await sql.execAsync(statement);
    if (fail && statement.includes('CREATE TABLE projections')) throw new Error('disk failure');
  } });
  t.after(() => database.close());
  await assert.rejects(database.initialize(), /disk failure/);
  assert.equal(await sql.getFirstAsync("SELECT name FROM sqlite_master WHERE name='projections'"), null);
  assert.equal((await sql.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!.user_version, 0);
  fail = false;
  await database.initialize();
});

test('file reopen preserves commands, barriers, cursor and recovers interrupted SENDING', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  await db.store.enqueue('ana', 'respondToAlarm', response('disable', 'DISABLED'), 1);
  await db.store.applyPage('ana', page());
  await db.store.saveRuntimeRevision('ana', 7);
  assert.equal((await db.store.claim('ana', 1))!.state, 'SENDING');
  await db.close();
  const reopened = await openTestStore(db.path); t.after(reopened.close);
  assert.equal((await reopened.store.operations('ana'))[0]!.state, 'QUEUED');
  assert.equal((await reopened.store.operations('ana'))[0]!.attempts, 1);
  assert.equal((await reopened.store.barriers('ana'))[0]!.operationId, 'disable');
  assert.deepEqual(await reopened.store.syncState('ana'), { cursor: 'cursor-1', syncedAt: 1000, runtimeRevision: 7 });
  assert.equal((await reopened.store.alarms('ana')).length, 1);
});

test('same operation and reordered object keys replay; changed payload conflicts atomically', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  const command = response();
  await db.store.enqueue('ana', 'respondToAlarm', command, 1);
  await db.store.enqueue('ana', 'respondToAlarm', { ...command, payload: { consentScope: 'THIS_OCCURRENCE', decision: 'ACCEPTED' } }, 2);
  await assert.rejects(db.store.enqueue('ana', 'respondToAlarm', response(command.operationId, 'DISABLED'), 3), { code: 'VERSION_CONFLICT' });
  assert.equal((await db.store.operations('ana')).length, 1);
  assert.equal((await db.store.barriers('ana')).length, 0);
});

test('account partitions include ids, events, projections, widgets and cleanup', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  for (const user of ['ana', 'luis']) {
    await db.store.enqueue(user, 'respondToAlarm', response('shared', 'DISABLED'), 1);
    await db.store.applyPage(user, page());
    await db.store.saveWidget(user, { user });
  }
  await db.store.beginCleanup('ana');
  assert.deepEqual(await db.store.pendingCleanup(), ['ana']);
  assert.equal(await db.store.readWidget('ana'), null);
  await db.store.clearUser('ana');
  assert.equal((await db.store.operations('ana')).length, 0);
  assert.equal((await db.store.alarms('ana')).length, 0);
  assert.equal((await db.store.barriers('ana')).length, 0);
  assert.equal((await db.store.syncState('ana')).cursor, null);
  assert.deepEqual(await db.store.pendingCleanup(), []);
  assert.equal((await db.store.operations('luis')).length, 1);
  assert.equal((await db.store.alarms('luis')).length, 1);
  assert.deepEqual(await db.store.readWidget('luis'), { user: 'luis' });
});

test('page failure rolls back earlier events and cursor; retry applies those same event ids', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  await db.store.applyPage('ana', page());
  const newer = alarm(); newer.request.requestVersion = 2;
  await db.database.read(sql => sql.execAsync("CREATE TRIGGER fail_cursor BEFORE UPDATE ON sync_state BEGIN SELECT RAISE(ABORT, 'disk failure'); END"));
  await assert.rejects(db.store.applyPage('ana', page(newer, 'event-2', 'cursor-2')), /disk failure/);
  assert.equal((await db.store.alarms('ana'))[0]!.request.requestVersion, 1);
  assert.equal((await db.store.syncState('ana')).cursor, 'cursor-1');
  await db.database.read(sql => sql.execAsync('DROP TRIGGER fail_cursor'));
  await db.store.applyPage('ana', page(newer, 'event-2', 'cursor-2'));
  assert.equal((await db.store.alarms('ana'))[0]!.request.requestVersion, 2);
  assert.equal((await db.store.syncState('ana')).cursor, 'cursor-2');
});

test('duplicates and independent request, decision and device counters never regress', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  const current = alarm(); current.request.requestVersion = 5; current.recipient.decisionRevision = 8; current.primaryDevice!.deviceEpoch = 3;
  await db.store.applyPage('ana', page(current));
  for (const dimension of ['request', 'decision', 'device'] as const) {
    const stale = structuredClone(current);
    stale.request.requestVersion = 6; stale.recipient.decisionRevision = 9; stale.primaryDevice!.deviceEpoch = 4;
    if (dimension === 'request') stale.request.requestVersion = 4;
    if (dimension === 'decision') stale.recipient.decisionRevision = 7;
    if (dimension === 'device') stale.primaryDevice!.deviceEpoch = 2;
    await db.store.applyPage('ana', page(stale, dimension));
    assert.deepEqual((await db.store.alarms('ana'))[0], current);
  }
  const next = structuredClone(current); next.recipient.decisionRevision++;
  await db.store.applyPage('ana', page(next, 'event-1'));
  assert.deepEqual((await db.store.alarms('ana'))[0], current);
  await db.store.applyPage('ana', page(next, 'new-decision'));
  assert.deepEqual((await db.store.alarms('ana'))[0], next);
  await db.store.saveRuntimeRevision('ana', 10); await db.store.saveRuntimeRevision('ana', 2);
  assert.equal((await db.store.syncState('ana')).runtimeRevision, 10);
});

test('revocation removes private data, fails queued work and rejects stale resurrection', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  await db.store.applyPage('ana', page());
  await db.store.enqueue('ana', 'respondToAlarm', response(), 1);
  await db.store.saveWidget('ana', { private: true });
  const { schedule } = scheduleAndAck(); await db.store.saveSchedule('ana', schedule);
  await db.store.applyPage('ana', { ...page(), events: [{ eventId: 'revoked', kind: 'revoke', groupId: 'piso-demo', requestId: 'req-001' }] });
  await db.store.applyPage('ana', page(alarm(), 'stale-after-revoke'));
  assert.deepEqual(await db.store.alarms('ana'), []);
  assert.equal(await db.store.readWidget('ana'), null);
  assert.equal((await db.store.operations('ana'))[0]!.state, 'FAILED_PERMANENT');
  assert.equal((await db.store.operations('ana'))[0]!.errorCode, 'FORBIDDEN');
  assert.equal((await db.store.schedules('ana')).length, 1, 'native cancellation still needs its minimal persisted spec');
});

test('cancellation barrier needs a later explicit acceptance confirmed at matching revision', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  await db.store.enqueue('ana', 'respondToAlarm', response('old-accept'), 1);
  await db.store.claim('ana', 1);
  await db.store.settle('ana', 'old-accept', 'CONFIRMED', { receipt: { operationId: 'old-accept', status: 'APPLIED', serverTimeEpochMs: 1, requestVersion: 1, decisionRevision: 2 } });
  await db.store.enqueue('ana', 'respondToAlarm', response('disable', 'DISABLED'), 2);
  await db.store.claim('ana', 2);
  await db.store.settle('ana', 'disable', 'CONFIRMED');
  await db.store.releaseBarrier('ana', alarm());
  assert.equal((await db.store.barriers('ana')).length, 1);
  await db.store.enqueue('ana', 'respondToAlarm', response('later-accept'), 3);
  await db.store.releaseBarrier('ana', alarm());
  assert.equal((await db.store.barriers('ana')).length, 1);
  const receipt = { operationId: 'later-accept', status: 'APPLIED' as const, serverTimeEpochMs: 3, requestVersion: 1, decisionRevision: 3 };
  await db.store.claim('ana', 3);
  await db.store.settle('ana', 'later-accept', 'CONFIRMED', { receipt });
  await db.store.releaseBarrier('ana', alarm());
  assert.equal((await db.store.barriers('ana')).length, 1);
  const confirmed = alarm(); confirmed.recipient.decisionRevision = 3;
  await db.store.releaseBarrier('ana', { ...confirmed, recipient: { ...confirmed.recipient, uid: 'luis' } });
  await db.store.releaseBarrier('ana', { ...confirmed, recipient: { ...confirmed.recipient, decision: 'REJECTED' } });
  await db.store.releaseBarrier('ana', { ...confirmed, recipient: { ...confirmed.recipient, acceptedRequestVersion: 0 } });
  assert.equal((await db.store.barriers('ana')).length, 1);
  await db.store.releaseBarrier('ana', confirmed);
  assert.deepEqual(await db.store.barriers('ana'), []);
});

test('sender keeps independent projections for all recipients of the same request', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  const ana = alarm();
  const bea = { ...alarm(), recipient: { ...alarm().recipient, uid: 'bea', decisionRevision: 1 } };
  await db.store.applyPage('luis', { ...page(), events: [
    { kind: 'upsert', eventId: 'recipient-ana', alarm: ana },
    { kind: 'upsert', eventId: 'recipient-bea', alarm: bea },
  ] });
  assert.deepEqual((await db.store.alarms('luis')).map(item => [item.recipient.uid, item.recipient.decisionRevision]), [['ana', 2], ['bea', 1]]);
  const update = { ...bea, recipient: { ...bea.recipient, decisionRevision: 2, decision: 'REJECTED' as const } };
  await db.store.applyPage('luis', page(update, 'bea-decision'));
  assert.deepEqual((await db.store.alarms('luis')).map(item => [item.recipient.uid, item.recipient.decision]), [['ana', 'ACCEPTED'], ['bea', 'REJECTED']]);
});

test('out-of-order remote schedule cannot replace a newer cancellation at the same versions', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  const record = alarm(); record.request.mode = 'ALARM';
  const { ack } = scheduleAndAck();
  record.schedules = [{ ...ack.payload, decisionRevision: record.recipient.decisionRevision, status: 'CANCELLED', statusUpdatedAtEpochMs: 2000 }];
  await db.store.applyPage('ana', page(record, 'cancelled-remote'));
  const stale = structuredClone(record);
  stale.schedules[0]!.status = 'SCHEDULED'; stale.schedules[0]!.statusUpdatedAtEpochMs = 1000;
  await db.store.applyPage('ana', page(stale, 'old-scheduled'));
  assert.equal((await db.store.alarms('ana'))[0]!.schedules[0]!.status, 'CANCELLED');
  stale.schedules[0]!.statusUpdatedAtEpochMs = 2000;
  await db.store.applyPage('ana', page(stale, 'same-time-scheduled'));
  assert.equal((await db.store.alarms('ana'))[0]!.schedules[0]!.status, 'CANCELLED');
});

test('schedule plus ACK is atomic in both insertion and conflicting replay', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  const { schedule, ack } = scheduleAndAck();
  await db.database.read(sql => sql.execAsync("CREATE TRIGGER fail_schedule BEFORE INSERT ON local_schedules BEGIN SELECT RAISE(ABORT, 'disk failure'); END"));
  await assert.rejects(db.store.saveSchedule('ana', schedule, ack), /disk failure/);
  assert.deepEqual(await db.store.operations('ana'), []);
  assert.deepEqual(await db.store.schedules('ana'), []);
  await db.database.read(sql => sql.execAsync('DROP TRIGGER fail_schedule'));
  await db.store.saveSchedule('ana', schedule, ack);
  await db.store.saveSchedule('ana', schedule, ack);
  assert.equal((await db.store.operations('ana')).length, 1);
  assert.equal((await db.store.operations('ana'))[0]!.lane, 'ACK');
  await assert.rejects(db.store.saveSchedule('ana', { ...schedule, status: 'CANCELLED' }, { ...ack, payload: { ...ack.payload, status: 'CANCELLED' } }), { code: 'VERSION_CONFLICT' });
  assert.equal((await db.store.schedules('ana'))[0]!.status, 'SCHEDULED');
});

test('complete schedule snapshot removes identities no longer authorized while preserving present monotonic state', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  const record = alarm(); record.primaryDevice = null;
  const { ack } = scheduleAndAck();
  record.schedules = [
    { ...ack.payload, deviceId: 'previous-primary', status: 'SCHEDULED', statusUpdatedAtEpochMs: 2000 },
    { ...ack.payload, deviceId: 'current-primary', deviceEpoch: 2, status: 'CANCELLED', statusUpdatedAtEpochMs: 3000 },
  ];
  await db.store.applyPage('luis', page(record, 'all-schedules'));
  const incoming = structuredClone(record);
  incoming.schedules = [{ ...record.schedules[1]!, status: 'SCHEDULED', statusUpdatedAtEpochMs: 2500 }];
  await db.store.applyPage('luis', page(incoming, 'authorized-schedules'));
  assert.deepEqual((await db.store.alarms('luis'))[0]!.schedules, [record.schedules[1]]);
  await db.store.applyPage('luis', page({ ...incoming, schedules: [] }, 'no-authorized-schedules'));
  assert.deepEqual((await db.store.alarms('luis'))[0]!.schedules, []);
});


for (const counter of ['requestVersion', 'decisionRevision'] as const) {
  test(`a newer ${counter} replaces cancellation at an equal timestamp without losing monotonicity`, async t => {
    const db = await openTestStore(); t.after(db.cleanup);
    const record = alarm();
    const { ack } = scheduleAndAck();
    record.schedules = [{ ...ack.payload, status: 'CANCELLED', statusUpdatedAtEpochMs: 2000 }];
    await db.store.applyPage('luis', page(record, 'cancelled'));
    const incoming = structuredClone(record);
    incoming.schedules[0]![counter] += 1;
    incoming.schedules[0]!.status = 'SCHEDULED';
    await db.store.applyPage('luis', page(incoming, 'new-consent'));
    assert.deepEqual((await db.store.alarms('luis'))[0]!.schedules, incoming.schedules);
    await db.store.applyPage('luis', page(record, 'old-revision'));
    assert.deepEqual((await db.store.alarms('luis'))[0]!.schedules, incoming.schedules);
    const olderTime = structuredClone(incoming);
    olderTime.schedules[0]![counter] += 1;
    olderTime.schedules[0]!.statusUpdatedAtEpochMs = 1999;
    await db.store.applyPage('luis', page(olderTime, 'older-timestamp'));
    assert.deepEqual((await db.store.alarms('luis'))[0]!.schedules, olderTime.schedules);
    await db.store.applyPage('luis', page(incoming, 'older-revision-newer-clock'));
    assert.deepEqual((await db.store.alarms('luis'))[0]!.schedules, olderTime.schedules);
  });
}

test('a later timestamp cannot revive a terminal schedule at the same revision', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  const record = alarm(); const { ack } = scheduleAndAck();
  record.schedules = [{ ...ack.payload, status: 'CANCELLED', statusUpdatedAtEpochMs: 2000 }];
  await db.store.applyPage('luis', page(record, 'cancelled'));
  const incoming = structuredClone(record);
  incoming.schedules[0]!.status = 'SCHEDULED'; incoming.schedules[0]!.statusUpdatedAtEpochMs = 3000;
  await db.store.applyPage('luis', page(incoming, 'late-scheduled'));
  assert.equal((await db.store.alarms('luis'))[0]!.schedules[0]!.status, 'CANCELLED');
});
