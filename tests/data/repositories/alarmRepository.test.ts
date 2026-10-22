import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PersistentAlarmRepository } from '../../../src/data/repositories/alarmRepository.ts';
import { ScheduleReconciler } from '../../../src/platform/sync/reconciler.ts';
import type { ReportSchedule } from '../../../src/domain/contracts/types.ts';
import { occurrenceKey } from '../../../src/domain/ids.ts';
import { openTestStore } from '../sqliteTestDatabase.ts';
import { page, response } from '../local/fixtures.ts';
import { deferred, NativeRuntime, setup } from './fakes.ts';

test('online acceptance confirms the command before native scheduling and sends its ACK', async t => {
  const s = await setup(t, false);
  s.runtime.onSchedule = () => { assert.deepEqual(s.server.trace, ['respondToAlarm', 'sync']); };
  const result = await s.repository.submit(response());
  assert.equal(result.status, 'APPLIED');
  assert.equal(s.runtime.scheduled.length, 1);
  assert.deepEqual(s.server.trace, ['respondToAlarm', 'sync', 'reportSchedule']);
  assert.equal(s.repository.getSnapshot().alarms[0]!.scheduling, 'SCHEDULED');
  assert.equal(s.repository.widgetSnapshot().groups[0]!.nextAlarm!.acknowledgementPending, false);
  await s.repository.reconcile();
  assert.equal(s.runtime.scheduled.length, 1, 'duplicate sync never schedules twice');
  assert.equal(s.server.commands.filter(item => item.kind === 'reportSchedule').length, 1);
});

test('offline acceptance remains durable and visibly pending without scheduling', async t => {
  const s = await setup(t, false); s.server.online = false;
  await assert.rejects(s.repository.submit(response()), { code: 'TEMPORARY_UNAVAILABLE', operationId: 'accept' });
  assert.equal(s.runtime.scheduled.length, 0);
  const snapshot = s.repository.getSnapshot();
  assert.equal(snapshot.stale, true); assert.equal(snapshot.alarms[0]!.pendingDecision, 'ACCEPTED');
  assert.equal(snapshot.alarms[0]!.decision, 'PENDING');
  assert.equal(snapshot.operations[0]!.state, 'QUEUED');
  await s.db.close();
  const reopened = await openTestStore(s.db.path); t.after(reopened.close);
  assert.equal((await reopened.store.operations('ana'))[0]!.command.operationId, 'accept');
});

test('native commit before SQLite result survives process restart without duplicate schedule', async t => {
  const s = await setup(t);
  const saveSchedule = s.db.store.saveSchedule.bind(s.db.store);
  s.db.store.saveSchedule = async (user, schedule, ack) => {
    if (schedule.status === 'SCHEDULED') throw new Error('simulated process death after native commit');
    return saveSchedule(user, schedule, ack);
  };
  await assert.rejects(s.reconciler.reconcile(true), /process death/);
  assert.equal(s.runtime.scheduled.length, 1);
  assert.equal((await s.db.store.schedules('ana'))[0]!.status, 'SCHEDULING');
  await s.db.close();
  const reopened = await openTestStore(s.db.path); t.after(reopened.close);
  const recovered = new ScheduleReconciler({ ...s.options, store: reopened.store });
  await recovered.reconcile(true);
  assert.equal(s.runtime.scheduled.length, 1);
  assert.equal((await reopened.store.schedules('ana'))[0]!.status, 'SCHEDULED');
  assert.equal((await reopened.store.operations('ana')).filter(item => item.kind === 'reportSchedule').length, 1);
});

test('offline disable cancels immediately and a stale accepted server snapshot cannot rearm', async t => {
  const s = await setup(t); await s.repository.reconcile();
  s.server.online = false;
  await s.repository.enqueue({ ...response('disable', 'DISABLED'), expectedDecisionRevision: 2 });
  assert.ok(s.runtime.cancelled.length >= 1);
  assert.equal((await s.db.store.schedules('ana'))[0]!.status, 'CANCELLED');
  assert.equal(s.repository.widgetSnapshot().groups[0]!.nextAlarm, null);
  await s.db.store.applyPage('ana', page(s.record, 'stale-after-local-disable'));
  await s.reconciler.reconcile(true);
  assert.equal(s.runtime.scheduled.length, 1);
  assert.equal((await s.db.store.barriers('ana')).length, 1);
});

test('offline time change preserves the earlier confirmed execution until remote confirmation', async t => {
  const s = await setup(t); await s.repository.reconcile();
  s.server.online = false;
  const command = response('other-time'); command.expectedDecisionRevision = 2;
  command.payload.chosenTimeSpec = { ...s.record.request.timeSpec, localTime: '22:00', effectiveAtEpochMs: s.record.request.timeSpec.effectiveAtEpochMs + 3_600_000 };
  await assert.rejects(s.repository.submit(command), { code: 'TEMPORARY_UNAVAILABLE' });
  assert.equal(s.runtime.scheduled.length, 1); assert.equal(s.runtime.cancelled.length, 0);
  assert.equal(s.repository.getSnapshot().alarms[0]!.effectiveAtEpochMs, s.record.request.timeSpec.effectiveAtEpochMs);
});

test('remote request version invalidates consent and cancels the old occurrence', async t => {
  const s = await setup(t); await s.repository.reconcile();
  s.server.records[0]!.request.requestVersion = 2;
  await s.repository.reconcile();
  assert.equal(s.runtime.scheduled.length, 1);
  assert.equal((await s.db.store.schedules('ana'))[0]!.status, 'CANCELLED');
  assert.equal(s.repository.widgetSnapshot().groups[0]!.nextAlarm, null);
});

test('a fresh explicit acceptance after disable releases its barrier and rearms once', async t => {
  const s = await setup(t); await s.repository.reconcile();
  await s.repository.submit({ ...response('disable', 'DISABLED'), expectedDecisionRevision: 2 });
  assert.equal((await s.db.store.barriers('ana')).length, 1);
  await s.repository.submit({ ...response('accept-again'), expectedDecisionRevision: 3 });
  assert.deepEqual(await s.db.store.barriers('ana'), []);
  assert.equal(s.runtime.scheduled.length, 2);
  assert.equal(s.runtime.scheduled[1]!.decisionRevision, 4);
  assert.equal(s.repository.widgetSnapshot().groups[0]!.nextAlarm!.requestId, s.record.requestId);
});

test('failed cancellation blocks replacement scheduling until the native cancellation succeeds', async t => {
  const s = await setup(t); await s.repository.reconcile();
  s.runtime.cancellationFails = true;
  s.server.records[0]!.recipient.decisionRevision++;
  s.server.records[0]!.recipient.chosenTimeSpec = { ...s.record.request.timeSpec, localTime: '22:00', effectiveAtEpochMs: s.record.request.timeSpec.effectiveAtEpochMs + 3_600_000 };
  await s.repository.reconcile();
  assert.equal(s.runtime.scheduled.length, 1);
  assert.equal(s.repository.getSnapshot().alarms[0]!.scheduling, 'CANCEL_PENDING');
  assert.equal(s.repository.widgetSnapshot().groups[0]!.nextAlarm, null);
  s.runtime.cancellationFails = false; await s.repository.reconcile();
  assert.equal(s.runtime.scheduled.length, 2);
  assert.equal(s.runtime.scheduled[1]!.effectiveAtEpochMs, s.record.request.timeSpec.effectiveAtEpochMs + 3_600_000);
});

test('device replacement cancels the prior epoch and never reports a stale device ACK', async t => {
  const s = await setup(t); await s.repository.reconcile();
  const before = s.server.commands.length;
  s.server.records[0]!.primaryDevice = { deviceId: 'other-phone', deviceEpoch: 2 };
  await s.repository.reconcile();
  assert.equal(s.runtime.scheduled.length, 1); assert.ok(s.runtime.cancelled.length >= 1);
  assert.equal(s.server.commands.slice(before).filter(item => item.kind === 'reportSchedule').length, 0);
});

for (const missing of ['runtime', 'permission'] as const) {
  test(`${missing} missing exposes a cause and cannot produce SCHEDULED`, async t => {
    const s = await setup(t);
    if (missing === 'runtime') s.runtime.available = false; else s.runtime.permission = false;
    await s.repository.reconcile();
    const view = s.repository.getSnapshot().alarms[0]!;
    assert.equal(view.scheduling, missing === 'runtime' ? 'FAILED' : 'PENDING_PERMISSION');
    assert.ok(view.reason); assert.equal(s.repository.widgetSnapshot().groups[0]!.nextAlarm, null);
    if (missing === 'permission') assert.equal(view.reason, 'EXACT_ALARM_PERMISSION_REQUIRED');
    assert.ok(s.server.commands.filter(item => item.kind === 'reportSchedule').every(item => (item.command as ReportSchedule).payload.status !== 'SCHEDULED'));
  });
}

test('conflicting response stays visible with its original operation id and versions', async t => {
  const s = await setup(t, false); s.server.conflict = true;
  const command = response();
  await assert.rejects(s.repository.submit(command), { code: 'VERSION_CONFLICT' });
  await s.repository.reconcile();
  const operation = (await s.db.store.operations('ana'))[0]!;
  assert.deepEqual(operation.command, command); assert.equal(operation.state, 'CONFLICT');
  assert.equal(s.server.commands.filter(item => item.kind === 'respondToAlarm').length, 1);
  assert.equal(s.runtime.scheduled.length, 0);
});

test('overdue one-shot never executes; accepted weekly series selects only a future slot', async t => {
  const s = await setup(t); s.setNow(s.record.request.timeSpec.effectiveAtEpochMs + 14 * 86_400_000);
  await s.repository.reconcile(); assert.equal(s.runtime.scheduled.length, 0);
  s.server.records[0]!.request.recurrence = { kind: 'WEEKLY', isoWeekday: 5, localTime: '21:00' };
  s.server.records[0]!.recipient.consentScope = 'SERIES';
  await s.repository.reconcile();
  assert.equal(s.runtime.scheduled.length, 1);
  assert.ok(s.runtime.scheduled[0]!.effectiveAtEpochMs > s.options.clock.nowEpochMs());
  assert.ok(s.runtime.scheduled[0]!.effectiveAtEpochMs <= s.options.clock.nowEpochMs() + 8 * 86_400_000);
});

test('sender sees each recipient remote execution status without scheduling for them', async t => {
  const s = await setup(t, true, 'luis');
  const accepted = s.server.records[0]!;
  accepted.request.recipientUids = ['ana', 'bea'];
  accepted.schedules = [{ occurrenceId: `occ-${accepted.request.timeSpec.effectiveAtEpochMs}`, deviceId: 'dev-a1', deviceEpoch: 1,
    requestVersion: 1, decisionRevision: 2, mode: 'ALARM', mechanism: 'ALARM_RUNTIME', status: 'SCHEDULED',
    effectiveAtEpochMs: accepted.request.timeSpec.effectiveAtEpochMs, reportedAtEpochMs: s.options.clock.nowEpochMs(), statusUpdatedAtEpochMs: s.options.clock.nowEpochMs() }];
  const other = structuredClone(accepted); other.recipient.uid = 'bea'; other.schedules[0]!.status = 'PENDING_PERMISSION'; other.schedules[0]!.reason = 'Missing permission';
  s.server.records.push(other);
  await s.repository.reconcile();
  assert.deepEqual(s.repository.getSnapshot().alarms.map(view => [view.alarm.recipient.uid, view.scheduling]), [['ana', 'SCHEDULED'], ['bea', 'PENDING_PERMISSION']]);
  assert.equal(s.runtime.scheduled.length, 0); assert.deepEqual(s.repository.widgetSnapshot().groups, []);
});

test('cleanup clears widget immediately; failed cancellation persists recovery until retry', async t => {
  const s = await setup(t); await s.repository.reconcile();
  s.runtime.cancellationFails = true;
  await assert.rejects(s.repository.cleanup(), /cancelaciones/);
  assert.equal(s.widgets.at(-1), null); assert.equal(await s.db.store.readWidget('ana'), null);
  assert.deepEqual(s.repository.getSnapshot().alarms, []);
  assert.deepEqual(await s.db.store.pendingCleanup(), ['ana']);
  assert.equal((await s.db.store.schedules('ana'))[0]!.status, 'CANCEL_PENDING');
  s.runtime.cancellationFails = false; await s.repository.cleanup();
  assert.deepEqual(await s.db.store.pendingCleanup(), []);
  assert.deepEqual(await s.db.store.schedules('ana'), []); assert.deepEqual(await s.db.store.alarms('ana'), []);
});

test('disable queued during native scheduling wins before any success ACK', async t => {
  const s = await setup(t);
  const started = deferred<void>(); const resume = deferred<void>();
  s.runtime.beforeSchedule = async () => { started.resolve(); await resume.promise; };
  const flight = s.repository.reconcile(); await started.promise;
  const disable = s.repository.enqueue({ ...response('disable-in-flight', 'DISABLED'), expectedDecisionRevision: 2 });
  // Wait for durable enqueue, without blocking on the native cancellation queue.
  for (let attempts = 0; attempts < 100 && !(await s.db.store.barriers('ana')).length; attempts++) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await s.db.store.barriers('ana')).length, 1);
  resume.resolve(); await Promise.all([flight, disable]);
  const key = occurrenceKey(s.runtime.scheduled[0]!);
  assert.equal(s.runtime.entries.get(key)!.status, 'CANCELLED');
  assert.ok((await s.db.store.operations('ana')).filter(item => item.kind === 'reportSchedule').every(item => (item.command as ReportSchedule).payload.status !== 'SCHEDULED'));
  assert.equal(s.repository.widgetSnapshot().groups[0]!.nextAlarm, null);
});

test('deactivation during native scheduling cancels effect and cannot republish private widget', async t => {
  const s = await setup(t);
  const started = deferred<void>(); const resume = deferred<void>();
  s.runtime.beforeSchedule = async () => { started.resolve(); await resume.promise; };
  const flight = s.repository.reconcile(); await started.promise;
  s.repository.deactivate(); s.expire(); const publications = s.widgets.length;
  resume.resolve(); await assert.rejects(flight, { code: 'UNAUTHENTICATED' });
  assert.equal(s.widgets.length, publications);
  assert.equal(s.runtime.entries.get(occurrenceKey(s.runtime.scheduled[0]!))!.status, 'CANCELLED');
  assert.deepEqual(s.repository.getSnapshot().alarms, []);
});

test('a historical FIRED event never becomes an ACK for a newer recipient decision', async t => {
  const s = await setup(t); await s.repository.reconcile();
  const oldSpec = s.runtime.scheduled[0]!;
  s.runtime.entries.get(occurrenceKey(oldSpec))!.status = 'FIRED'; s.runtime.revision++;
  await s.repository.reconcile();
  s.server.records[0]!.recipient.decisionRevision++;
  const commandCount = s.server.commands.length;
  await s.repository.reconcile();
  const newReports = s.server.commands.slice(commandCount).filter(item => item.kind === 'reportSchedule').map(item => (item.command as ReportSchedule).payload);
  assert.ok(newReports.every(report => report.status !== 'FIRED' || report.decisionRevision === oldSpec.decisionRevision));
  assert.ok((await s.db.store.operations('ana')).filter(item => item.kind === 'reportSchedule').every(item => {
    const payload = (item.command as ReportSchedule).payload;
    return payload.status !== 'FIRED' || payload.decisionRevision === oldSpec.decisionRevision;
  }));
});

test('cleanup retains its recovery marker when an orphan native occurrence cannot cancel', async t => {
  const s = await setup(t); await s.repository.reconcile();
  const orphan = { ...s.runtime.scheduled[0]!, requestId: 'orphan-request', occurrenceId: 'occ-orphan' };
  s.runtime.entries.clear(); s.runtime.entries.set(occurrenceKey(orphan), { spec: orphan, status: 'SCHEDULED' }); s.runtime.revision++;
  await s.db.store.clearUser('ana');
  s.runtime.cancellationFails = true;
  await assert.rejects(s.reconciler.cleanup(), /huérfana|cancelaci/);
  assert.deepEqual(await s.db.store.pendingCleanup(), ['ana']);
  assert.equal(s.runtime.entries.get(occurrenceKey(orphan))!.status, 'SCHEDULED');
  s.runtime.cancellationFails = false; await s.reconciler.cleanup();
  assert.deepEqual(await s.db.store.pendingCleanup(), []);
  assert.equal(s.runtime.entries.get(occurrenceKey(orphan))!.status, 'CANCELLED');
});

for (const bumpRequestVersion of [false, true]) {
  test(`explicit acceptance replaces same-time execution once when ${bumpRequestVersion ? 'request and decision' : 'decision'} versions change`, async t => {
    const s = await setup(t); await s.repository.reconcile();
    if (bumpRequestVersion) s.server.records[0]!.request.requestVersion++;
    const command = { ...response('accept-new-revision'), expectedRequestVersion: bumpRequestVersion ? 2 : 1, expectedDecisionRevision: 2 };
    await s.repository.submit(command);
    assert.equal(s.runtime.scheduled.length, 2);
    assert.equal(s.runtime.scheduled[1]!.effectiveAtEpochMs, s.runtime.scheduled[0]!.effectiveAtEpochMs);
    assert.equal(s.runtime.scheduled[1]!.decisionRevision, 3);
    assert.equal(s.runtime.scheduled[1]!.requestVersion, bumpRequestVersion ? 2 : 1);
    await s.repository.reconcile(); assert.equal(s.runtime.scheduled.length, 2);
    assert.equal(s.repository.getSnapshot().alarms[0]!.scheduling, 'SCHEDULED');
  });
}

test('native CANCELLED tombstone survives a delayed SCHEDULED snapshot at identical spec and revision', async t => {
  const s = await setup(t); await s.repository.reconcile();
  const key = occurrenceKey(s.runtime.scheduled[0]!);
  s.runtime.entries.get(key)!.status = 'CANCELLED'; s.runtime.revision++;
  await s.repository.reconcile();
  assert.equal((await s.db.store.schedules('ana'))[0]!.status, 'CANCELLED');
  const count = s.server.commands.length;
  s.runtime.entries.get(key)!.status = 'SCHEDULED';
  await s.repository.reconcile();
  assert.equal((await s.db.store.schedules('ana'))[0]!.status, 'CANCELLED');
  assert.equal(s.repository.widgetSnapshot().groups[0]!.nextAlarm, null);
  assert.equal(s.runtime.scheduled.length, 1);
  assert.ok(s.server.commands.slice(count).every(item => item.kind !== 'reportSchedule' || (item.command as ReportSchedule).payload.status !== 'SCHEDULED'));
});

test('revoked exact-alarm capability overrides stale native success and recovery never duplicates scheduling', async t => {
  const s = await setup(t); await s.repository.reconcile();
  let exactAlarms = false;
  s.runtime.getCapabilities = async () => ({ available: true, exactAlarms, audibleAlarms: true, notifications: true });
  const count = s.server.commands.length;
  await s.repository.reconcile();
  assert.equal(s.repository.getSnapshot().alarms[0]!.scheduling, 'PENDING_PERMISSION');
  assert.equal(s.repository.getSnapshot().alarms[0]!.reason, 'EXACT_ALARM_PERMISSION_REQUIRED');
  assert.equal(s.repository.widgetSnapshot().groups[0]!.nextAlarm, null);
  assert.equal(s.runtime.scheduled.length, 1);
  assert.ok(s.server.commands.slice(count).every(item => item.kind !== 'reportSchedule' || (item.command as ReportSchedule).payload.status !== 'SCHEDULED'));
  exactAlarms = true; await s.repository.reconcile();
  assert.equal(s.repository.getSnapshot().alarms[0]!.scheduling, 'SCHEDULED');
  assert.equal(s.repository.getSnapshot().alarms[0]!.reason, undefined);
  assert.equal(s.runtime.scheduled.length, 1);
  assert.equal(s.runtime.cancelled.length, 0);
});

test('unavailable capability marks a previously scheduled occurrence failed with its concrete cause', async t => {
  const s = await setup(t); await s.repository.reconcile();
  s.runtime.getCapabilities = async () => ({ available: false, exactAlarms: true, audibleAlarms: true, notifications: true, reason: 'NATIVE_MODULE_UNAVAILABLE' });
  const count = s.server.commands.length;
  await s.repository.reconcile();
  assert.equal(s.repository.getSnapshot().alarms[0]!.scheduling, 'FAILED');
  assert.equal(s.repository.getSnapshot().alarms[0]!.reason, 'NATIVE_MODULE_UNAVAILABLE');
  assert.equal(s.repository.widgetSnapshot().groups[0]!.nextAlarm, null);
  assert.equal(s.runtime.scheduled.length, 1);
  assert.ok(s.server.commands.slice(count).every(item => item.kind !== 'reportSchedule' || (item.command as ReportSchedule).payload.status !== 'SCHEDULED'));
});

for (const adapterAvailable of [true, false]) {
  test(`NOTIFICATION ${adapterAvailable ? 'uses its dedicated adapter and ACK mechanism' : 'fails without an adapter and never falls back to audible scheduling'}`, async t => {
    const s = await setup(t);
    s.server.records[0]!.request.mode = 'NOTIFICATION';
    const notificationRuntime = new NativeRuntime();
    const repository = new PersistentAlarmRepository({ ...s.options, notificationRuntime: adapterAvailable ? notificationRuntime : undefined });
    await repository.reconcile();
    assert.equal(s.runtime.scheduled.length, 0);
    assert.equal(s.runtime.cancelled.length, 0);
    assert.equal(notificationRuntime.scheduled.length, adapterAvailable ? 1 : 0);
    assert.equal(repository.getSnapshot().alarms[0]!.scheduling, adapterAvailable ? 'SCHEDULED' : 'FAILED');
    const reports = s.server.commands.filter(item => item.kind === 'reportSchedule').map(item => (item.command as ReportSchedule).payload);
    assert.ok(reports.length >= 1);
    assert.ok(reports.every(report => report.mode === 'NOTIFICATION' && report.mechanism === 'EXPO_NOTIFICATIONS'));
    assert.ok(reports.every(report => report.status === (adapterAvailable ? 'SCHEDULED' : 'FAILED')));
    if (adapterAvailable) {
      await repository.enqueue({ ...response('disable-notification', 'DISABLED'), expectedDecisionRevision: 2 });
      assert.equal(s.runtime.cancelled.length, 0); assert.ok(notificationRuntime.cancelled.length >= 1);
    }
  });
}

test('cleanup waits for in-flight enqueue and prevents old identity writes or publications after completion', async t => {
  const s = await setup(t, false); await s.repository.load();
  const started = deferred<void>(); const resume = deferred<void>();
  const enqueue = s.db.store.enqueue.bind(s.db.store);
  let cleaned = false; let writesAfterCleanup = 0;
  s.db.store.enqueue = async (...args) => {
    started.resolve(); await resume.promise;
    if (cleaned) writesAfterCleanup++;
    await enqueue(...args);
  };
  const action = s.repository.enqueue(response());
  const rejected = assert.rejects(action, { code: 'UNAUTHENTICATED' });
  await started.promise;
  s.repository.deactivate(); const publications = s.widgets.length;
  let idle = false;
  const idleFlight = s.repository.whenIdle().then(() => { idle = true; });
  const cleanup = s.repository.cleanup().then(() => { cleaned = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(idle, false); assert.equal(cleaned, false);
  resume.resolve(); await Promise.all([rejected, idleFlight, cleanup]);
  assert.equal(writesAfterCleanup, 0);
  assert.deepEqual(s.widgets.slice(publications), [null]);
  assert.deepEqual(await s.db.store.operations('ana'), []);
  assert.deepEqual(await s.db.store.alarms('ana'), []);
  assert.equal(await s.db.store.readWidget('ana'), null);
});
