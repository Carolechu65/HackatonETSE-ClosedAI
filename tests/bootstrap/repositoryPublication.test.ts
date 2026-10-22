import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PersistentAlarmRepository, type PersistedWidgetSnapshot } from '../../src/data/repositories/alarmRepository.ts';
import { openTestStore } from '../data/sqliteTestDatabase.ts';
import { alarm, page, response, scheduleAndAck } from '../data/local/fixtures.ts';
import type { AlarmRuntime } from '../../src/platform/alarms/index.ts';
import { occurrenceIdFromEpochMs } from '../../src/domain/ids.ts';

const runtime: AlarmRuntime = {
  async getSnapshot() { return { available: true, revision: 1, occurrences: [] }; },
  async cancel(key) { return { status: 'CANCELLED', key }; },
  async schedule() { throw new Error('not used'); },
  async getCapabilities() { return { available: true, audibleAlarms: true, exactAlarms: true, notifications: false }; },
};
function repository(store: Awaited<ReturnType<typeof openTestStore>>['store'], publishWidget?: (snapshot: PersistedWidgetSnapshot | null) => Promise<void>) {
  return new PersistentAlarmRepository({ userId: 'ana', deviceId: 'dev-a1', store, runtime,
    clock: { nowEpochMs: () => 1000 }, ids: { next: () => 'unused' }, assertCurrent() {}, publishWidget,
    gateway: { async execute() { throw new Error('offline'); }, async sync() { throw new Error('offline'); } } });
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test('current future execution beats a historical terminal occurrence with a newer local timestamp', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  const record = alarm(); record.request.mode = 'ALARM'; await db.store.applyPage('ana', page(record));
  const current = scheduleAndAck().schedule; current.spec.decisionRevision = record.recipient.decisionRevision;
  current.updatedAt = 10; await db.store.saveSchedule('ana', current);
  const old = JSON.parse(JSON.stringify(current)); old.status = 'FIRED'; old.updatedAt = 999999;
  old.spec.effectiveAtEpochMs = 500; old.spec.occurrenceId = occurrenceIdFromEpochMs(500);
  await db.store.saveSchedule('ana', old);
  const repo = repository(db.store); await repo.load();
  assert.equal(repo.getSnapshot().alarms[0]!.scheduling, 'SCHEDULED');
  assert.equal(repo.widgetSnapshot().groups[0]!.nextAlarm?.effectiveAtEpochMs, current.spec.effectiveAtEpochMs);
});

test('a different revision or device epoch never appears as the current scheduled widget alarm', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  const record = alarm(); record.request.mode = 'ALARM'; await db.store.applyPage('ana', page(record));
  const old = scheduleAndAck().schedule; // decision 1, server decision 2
  await db.store.saveSchedule('ana', old);
  const repo = repository(db.store); await repo.load();
  assert.equal(repo.widgetSnapshot().groups[0]!.nextAlarm, null);
  old.spec.decisionRevision = record.recipient.decisionRevision; old.spec.deviceEpoch = 2;
  await db.store.saveSchedule('ana', old); await repo.load();
  assert.equal(repo.widgetSnapshot().groups[0]!.nextAlarm, null);
});

test('offline pending accepted time change preserves the previous actual scheduled occurrence', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  const record = alarm(); record.request.mode = 'ALARM'; await db.store.applyPage('ana', page(record));
  const current = scheduleAndAck().schedule; current.spec.decisionRevision = record.recipient.decisionRevision;
  await db.store.saveSchedule('ana', current);
  await db.store.enqueue('ana', 'respondToAlarm', response('pending-time-change'), 1000);
  const repo = repository(db.store); await repo.load();
  assert.equal(repo.getSnapshot().alarms[0]!.pendingDecision, 'ACCEPTED');
  assert.equal(repo.getSnapshot().alarms[0]!.scheduling, 'SCHEDULED');
  assert.equal(repo.widgetSnapshot().groups[0]!.nextAlarm?.effectiveAtEpochMs, current.spec.effectiveAtEpochMs);
});

test('cleanup drains an old asynchronous widget publication before clearing it', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  await db.store.applyPage('ana', page());
  let entered!: () => void; const publishing = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const completed: (string | null)[] = [];
  const repo = repository(db.store, async snapshot => {
    if (snapshot) { entered(); await gate; }
    completed.push(snapshot?.userId ?? null);
  });
  const load = repo.load(); await publishing;
  const cleanup = repo.cleanup(); await settle();
  assert.deepEqual(repo.getSnapshot().alarms, []);
  assert.deepEqual(completed, []);
  release(); await load; await cleanup;
  assert.deepEqual(completed, ['ana', null]);
  assert.equal(await db.store.readWidget('ana'), null);
  await assert.rejects(repo.load(), { code: 'UNAUTHENTICATED' });
});

test('a throwing UI observer cannot prevent logout clearing other observers and widgets', async t => {
  const db = await openTestStore(); t.after(db.cleanup);
  let first = true;
  const repo = repository(db.store);
  repo.subscribe(() => { if (first) { first = false; return; } throw new Error('broken UI'); });
  let cleared = false; repo.subscribe(snapshot => { if (!snapshot.alarms.length) cleared = true; });
  await repo.cleanup(); assert.equal(cleared, true);
});
