import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notificationIdentity, notificationRuntime, type NotificationDriver, type NotificationRecord } from '../src/platform/notifications/runtime.ts';
import type { LocalOccurrence } from '../src/platform/alarms/index.ts';

const spec: LocalOccurrence = { userId: 'u', requestId: 'r', occurrenceId: 'o', deviceId: 'd', deviceEpoch: 1, requestVersion: 1, decisionRevision: 1, effectiveAtEpochMs: 10_000, timeZone: 'Europe/Madrid', title: 'Basura', mode: 'NOTIFICATION' };
function harness() {
  const records = new Map<string, NotificationRecord>();
  const registered = new Set<string>();
  const presented = new Set<string>();
  let revision = 0;
  let allowed = true;
  let failCancel = false;
  let time = 100;
  const driver: NotificationDriver = {
    async read() { return { revision, records: structuredClone([...records.values()]) }; },
    async write(record) { records.set(record.id, structuredClone(record)); revision++; },
    async permission() { return allowed; },
    async schedule(id) { registered.add(id); },
    async cancel(id) { if (failCancel) throw new Error('OS failure'); registered.delete(id); presented.delete(id); },
    async registered() { return new Set(registered); },
    async presented() { return new Set(presented); },
  };
  return { runtime: notificationRuntime(driver, () => time), registered, records, presented, setAllowed(value: boolean) { allowed = value; }, failCancel(value: boolean) { failCancel = value; }, setTime(value: number) { time = value; } };
}
test('notification retries keep one OS registration, cancel blocks stale replay, newer consent can reaccept', async () => {
  const h = harness();
  await Promise.all([h.runtime.schedule(spec), h.runtime.schedule(spec)]);
  assert.equal(h.registered.size, 1);
  assert.equal((await h.runtime.cancel(spec)).status, 'CANCELLED');
  assert.equal((await h.runtime.schedule(spec)).status, 'FAILED');
  assert.equal(h.registered.size, 0);
  assert.equal((await h.runtime.schedule({ ...spec, decisionRevision: 2 })).status, 'SCHEDULED');
});
test('permission denied never schedules and recovery never revives an expired occurrence', async () => {
  const h = harness();
  h.setAllowed(false);
  assert.equal((await h.runtime.schedule(spec)).status, 'PENDING_PERMISSION');
  assert.equal(h.registered.size, 0);
  h.setAllowed(true);
  await h.runtime.schedule(spec);
  h.registered.clear(); // Android lost a registration; reconcile repairs a future intent.
  assert.equal((await h.runtime.getSnapshot()).occurrences[0]?.status, 'SCHEDULED');
  assert.equal(h.registered.size, 1);
  h.setTime(20_000);
  assert.equal((await h.runtime.getSnapshot()).occurrences[0]?.status, 'EXPIRED');
});
test('failed OS cancel retains a durable tombstone and is repaired later', async () => {
  const h = harness();
  await h.runtime.schedule(spec);
  h.failCancel(true);
  assert.equal((await h.runtime.cancel(spec)).status, 'CANCEL_PENDING');
  assert.equal(h.records.get(notificationIdentity(spec))?.status, 'CANCELLED');
  assert.equal((await h.runtime.schedule(spec)).status, 'FAILED');
  h.failCancel(false);
  await h.runtime.getSnapshot();
  assert.equal(h.registered.size, 0);
});
test('new decision cancels previous identity and rejects older version on a different occurrence', async () => {
  const h = harness();
  await h.runtime.schedule(spec);
  await h.runtime.schedule({ ...spec, occurrenceId: 'new', decisionRevision: 2 });
  assert.equal(h.registered.size, 1);
  assert.equal((await h.runtime.schedule({ ...spec, occurrenceId: 'stale' })).status, 'FAILED');
});
test('unknown cancel is fail-closed and identity cannot collide through separators', async () => {
  const h = harness();
  await h.runtime.cancel(spec);
  assert.equal((await h.runtime.schedule(spec)).status, 'FAILED');
  assert.notEqual(notificationIdentity({ ...spec, userId: 'a|b', requestId: 'c' }), notificationIdentity({ ...spec, userId: 'a', requestId: 'b|c' }));
});
