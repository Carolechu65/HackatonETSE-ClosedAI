import assert from 'node:assert/strict';
import { test } from 'node:test';
import { occurrenceKey } from '../../../src/domain/ids.ts';
import type { ReportSchedule } from '../../../src/domain/contracts/types.ts';
import { response } from '../local/fixtures.ts';
import { setup } from './fakes.ts';

async function snoozedFixture(t: Parameters<typeof setup>[0], observedFired = false) {
  const s = await setup(t);
  await s.repository.reconcile();
  const original = s.runtime.scheduled[0]!;
  const entry = s.runtime.entries.get(occurrenceKey(original))!;
  s.setNow(original.effectiveAtEpochMs + 1_000);
  if (observedFired) {
    entry.status = 'FIRED'; s.runtime.revision++;
    await s.repository.reconcile();
    assert.equal(s.repository.getSnapshot().alarms[0]!.scheduling, 'FIRED');
  }
  const future = original.effectiveAtEpochMs + 5 * 60_000;
  entry.status = 'SCHEDULED';
  entry.spec = { ...original, effectiveAtEpochMs: future };
  entry.acceptedEffectiveAtEpochMs = original.effectiveAtEpochMs;
  entry.scheduledAtEpochMs = future;
  entry.snoozeCount = 1;
  s.runtime.revision++;
  return { ...s, original, entry, future };
}

for (const observedFired of [false, true]) {
  test(`resuming a native snooze preserves consent and widget timing (observed fired: ${observedFired})`, async t => {
    const s = await snoozedFixture(t, observedFired);
    await s.repository.reconcile();
    await s.repository.reconcile();
    assert.equal(s.runtime.scheduled.length, 1, 'no new original or snoozed occurrence is scheduled');
    assert.equal(s.runtime.cancelled.length, 0, 'elapsed original time does not cancel future snooze');
    const view = s.repository.getSnapshot().alarms[0]!;
    assert.equal(view.scheduling, 'SCHEDULED');
    assert.equal(view.effectiveAtEpochMs, s.future);
    assert.equal(view.localSchedule!.spec.effectiveAtEpochMs, s.original.effectiveAtEpochMs);
    assert.equal(s.repository.widgetSnapshot().groups[0]!.nextAlarm!.effectiveAtEpochMs, s.future);
    assert.equal(s.repository.widgetSnapshot().groups[0]!.nextAlarm!.occurrenceId, s.original.occurrenceId);
    const reports = s.server.commands.filter(item => item.kind === 'reportSchedule');
    assert.ok(reports.every(item => (item.command as ReportSchedule).payload.effectiveAtEpochMs === s.original.effectiveAtEpochMs), 'ACK retains original accepted time');
    assert.equal(reports.length, observedFired ? 3 : 1, 'unchanged snooze recovery never duplicates an ACK');
  });
}

test('remote withdrawal overrides a future native snooze', async t => {
  const s = await snoozedFixture(t);
  s.server.records[0]!.request.status = 'WITHDRAWN';
  await s.repository.reconcile();
  assert.ok(s.runtime.cancelled.length > 0);
  assert.equal(s.repository.getSnapshot().alarms[0]!.scheduling, 'CANCELLED');
  assert.equal(s.repository.widgetSnapshot().groups[0]!.nextAlarm, null);
});

test('offline disable overrides a future native snooze and stale replay', async t => {
  const s = await snoozedFixture(t);
  s.server.online = false;
  await s.repository.enqueue({ ...response('disable-snooze', 'DISABLED'), expectedDecisionRevision: 2 });
  assert.equal(s.entry.status, 'CANCELLED');
  s.entry.status = 'SCHEDULED'; s.runtime.revision++;
  await s.reconciler.reconcile(true);
  assert.equal((await s.db.store.schedules('ana'))[0]!.status, 'CANCELLED');
  assert.equal(s.runtime.scheduled.length, 1);
  assert.equal(s.repository.widgetSnapshot().groups[0]!.nextAlarm, null);
});

test('new request terms invalidate even a future native snooze', async t => {
  const s = await snoozedFixture(t);
  s.server.records[0]!.request.requestVersion++;
  await s.repository.reconcile();
  assert.equal(s.entry.status, 'CANCELLED');
  assert.equal(s.repository.widgetSnapshot().groups[0]!.nextAlarm, null);
  assert.equal(s.runtime.scheduled.length, 1);
});
