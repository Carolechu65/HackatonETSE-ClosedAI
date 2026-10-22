import assert from 'node:assert/strict';
import test from 'node:test';
import { auth, createAlarm, createAlarmBody, createGroup, FUTURE_TIME, inviteAndJoin, operationId, registerDevice, registerUser, setupTest } from './helpers.ts';

type Context = Awaited<ReturnType<typeof setupTest>>;
async function fixture(ctx: Context, series = false, scope: 'SERIES' | 'THIS_OCCURRENCE' = 'SERIES', acceptInitially = true) {
  const sender = await registerUser(ctx.app, 'A'); const receiver = await registerUser(ctx.app, 'B');
  const groupId = await createGroup(ctx.app, sender); await inviteAndJoin(ctx.app, sender, groupId, receiver);
  let requestId: string;
  if (series) {
    const body = createAlarmBody({ groupId, recipientUids: [receiver.uid] });
    (body.payload as Record<string, unknown>).recurrence = { kind: 'WEEKLY', isoWeekday: 2, localTime: FUTURE_TIME.localTime,
      untilEpochMs: FUTURE_TIME.effectiveAtEpochMs + 14 * 86400000 };
    const result = await ctx.app.inject({ method: 'POST', url: '/v1/operations/createAlarmRequest', headers: auth(sender.token), payload: body });
    assert.equal(result.statusCode, 200, result.body); requestId = result.json().result.requestId;
  } else requestId = await createAlarm(ctx.app, sender, groupId, [receiver.uid]);
  const device = await registerDevice(ctx.app, receiver);
  async function operation(name: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}, token = receiver.token) {
    return ctx.app.inject({ method: 'POST', url: `/v1/operations/${name}`, headers: auth(token),
      payload: { schemaVersion: 1, operationId: operationId(name), groupId, entityId: requestId, ...extra, payload } });
  }
  if (acceptInitially) {
  const accept = await operation('respondToAlarm', { decision: 'ACCEPTED', consentScope: series ? scope : 'THIS_OCCURRENCE' },
    { expectedRequestVersion: 1, expectedDecisionRevision: 1 });
  assert.equal(accept.statusCode, 200, accept.body);
  }
  const base = { ...device, requestVersion: 1, decisionRevision: 2, occurrenceId: `occ-${FUTURE_TIME.effectiveAtEpochMs}`,
    effectiveAtEpochMs: FUTURE_TIME.effectiveAtEpochMs, mode: 'ALARM', mechanism: 'ALARM_RUNTIME', reportedAtEpochMs: Date.now() };
  // registerDevice's wire response also has primary, which is not part of reportSchedule.
  const report = (status: string, overrides: Record<string, unknown> = {}) => operation('reportSchedule', {
    deviceId: base.deviceId, deviceEpoch: base.deviceEpoch, requestVersion: 1, decisionRevision: 2,
    occurrenceId: base.occurrenceId, effectiveAtEpochMs: base.effectiveAtEpochMs, mode: base.mode,
    mechanism: base.mechanism, reportedAtEpochMs: base.reportedAtEpochMs, status, ...overrides });
  const schedules = async () => (await ctx.app.inject({ method: 'GET', url: `/v1/groups/${groupId}/alarm-requests/${requestId}/schedules`, headers: auth(sender.token) })).json().schedules as Array<Record<string, unknown>>;
  return { sender, receiver, groupId, requestId, device, operation, report, schedules, base };
}

for (const decision of ['DISABLED', 'REJECTED'] as const) {
  test(`P5 ${decision} accepts cancellation ACK but never new execution`, async t => {
    const ctx = await setupTest(); t.after(ctx.close); const f = await fixture(ctx, false, 'THIS_OCCURRENCE', decision !== 'REJECTED');
    if (decision !== 'REJECTED') assert.equal((await f.report('SCHEDULED')).statusCode, 200);
    const revision = decision === 'REJECTED' ? 2 : 3;
    const disable = await f.operation('respondToAlarm', { decision }, { expectedRequestVersion: 1, expectedDecisionRevision: revision - 1 });
    assert.equal(disable.statusCode, 200, disable.body);
    for (const status of ['CANCEL_PENDING', 'CANCELLED']) {
      const result = await f.report(status, { decisionRevision: revision, reportedAtEpochMs: Date.now() });
      assert.equal(result.statusCode, 200, result.body);
    }
    const activate = await f.report('SCHEDULED', { decisionRevision: revision }); assert.equal(activate.statusCode, 409);
    const stale = await f.report('CANCELLED', { decisionRevision: revision - 1 }); assert.equal(stale.statusCode, 409);
    assert.equal((await f.schedules())[0]!.status, 'CANCELLED');
  });
}

test('P5 withdrawal clears consent and accepts current cancellation of a past occurrence', async t => {
  const ctx = await setupTest(); t.after(ctx.close); const f = await fixture(ctx);
  const withdrawn = await f.operation('withdrawAlarmRequest', { reason: 'cancel' }, { expectedRequestVersion: 1 }, f.sender.token);
  assert.equal(withdrawn.statusCode, 200, withdrawn.body);
  const row = ctx.db.prepare('SELECT * FROM alarm_recipients WHERE request_id=?').get(f.requestId) as Record<string, unknown>;
  assert.equal(row.consent_scope, null); assert.equal(row.chosen_effective_at_epoch_ms, null);
  const result = await f.report('CANCELLED', { decisionRevision: 3, occurrenceId: 'occ-1000', effectiveAtEpochMs: 1000 });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal((await f.report('SCHEDULED', { decisionRevision: 3 })).statusCode, 409);
  assert.equal((await f.report('CANCELLED', { requestVersion: 2, decisionRevision: 3 })).statusCode, 409);
});

test('P5 only current primary epoch is visible and an old device cannot report even cancellation', async t => {
  const ctx = await setupTest(); t.after(ctx.close); const f = await fixture(ctx);
  assert.equal((await f.report('SCHEDULED')).statusCode, 200); assert.equal((await f.schedules()).length, 1);
  const replacement = await registerDevice(ctx.app, f.receiver);
  const primary = await ctx.app.inject({ method: 'POST', url: `/v1/devices/${replacement.deviceId}/primary`, headers: auth(f.receiver.token) });
  assert.equal(primary.statusCode, 200); assert.equal((await f.schedules()).length, 0);
  assert.equal((await f.report('CANCELLED')).statusCode, 403);
});

test('P5 a newer accepted decision for the same occurrence replaces persisted revision even with equal timestamp', async t => {
  const ctx = await setupTest(); t.after(ctx.close); const f = await fixture(ctx);
  assert.equal((await f.report('FAILED', { reason: 'native failure' })).statusCode, 200);
  const accepted = await f.operation('respondToAlarm', { decision: 'ACCEPTED', consentScope: 'THIS_OCCURRENCE' }, { expectedRequestVersion: 1, expectedDecisionRevision: 2 });
  assert.equal(accepted.statusCode, 200, accepted.body);
  const scheduled = await f.report('SCHEDULED', { decisionRevision: 3 }); assert.equal(scheduled.statusCode, 200, scheduled.body);
  const rows = await f.schedules(); assert.equal(rows[0]!.decision_revision, 3); assert.equal(rows[0]!.status, 'SCHEDULED');
  const old = await f.report('FAILED', { decisionRevision: 3, reason: 'late old failure', reportedAtEpochMs: f.base.reportedAtEpochMs - 1000 });
  assert.equal(old.statusCode, 200); assert.equal((await f.schedules())[0]!.status, 'SCHEDULED');
});

test('P5 SERIES accepts exact later weekly slots but rejects wrong time and after until', async t => {
  const ctx = await setupTest(); t.after(ctx.close); const f = await fixture(ctx, true);
  for (const days of [7, 8, 21]) {
    const time = FUTURE_TIME.effectiveAtEpochMs + days * 86400000;
    const result = await f.report('SCHEDULED', { occurrenceId: `occ-${time}`, effectiveAtEpochMs: time });
    assert.equal(result.statusCode, days === 7 ? 200 : 400, result.body);
  }
});

test('P5 THIS_OCCURRENCE never permits scheduling the next weekly slot', async t => {
  const ctx = await setupTest(); t.after(ctx.close); const f = await fixture(ctx, true, 'THIS_OCCURRENCE');
  const time = FUTURE_TIME.effectiveAtEpochMs + 7 * 86400000;
  assert.equal((await f.report('SCHEDULED', { occurrenceId: `occ-${time}`, effectiveAtEpochMs: time })).statusCode, 400);
});

test('P5 an authoritative expired request accepts cancellation but rejects execution', async t => {
  const ctx = await setupTest(); t.after(ctx.close); const f = await fixture(ctx);
  // Seed the server clock-transition outcome; the HTTP cancellation still runs all authorization checks.
  ctx.db.prepare("UPDATE alarm_requests SET status='EXPIRED', expired_at_epoch_ms=? WHERE id=?").run(Date.now(), f.requestId);
  const cancellation = await f.report('CANCELLED'); assert.equal(cancellation.statusCode, 200, cancellation.body);
  const execution = await f.report('SCHEDULED'); assert.equal(execution.statusCode, 409); assert.equal(execution.json().code, 'EXPIRED');
});

for (const terminal of ['CANCELLED', 'EXPIRED', 'FIRED']) {
  test(`P5 ${terminal} stays terminal within the same consent but new consent can replace it`, async t => {
    const ctx = await setupTest(); t.after(ctx.close); const f = await fixture(ctx);
    assert.equal((await f.report(terminal)).statusCode, 200);
    const late = await f.report('SCHEDULED', { reportedAtEpochMs: f.base.reportedAtEpochMs + 1000 });
    assert.equal(late.statusCode, 200, late.body); assert.equal(late.json().result.ignored, true);
    assert.equal((await f.schedules())[0]!.status, terminal);
    const accepted = await f.operation('respondToAlarm', { decision: 'ACCEPTED', consentScope: 'THIS_OCCURRENCE' },
      { expectedRequestVersion: 1, expectedDecisionRevision: 2 });
    assert.equal(accepted.statusCode, 200, accepted.body);
    const scheduled = await f.report('SCHEDULED', { decisionRevision: 3 });
    assert.equal(scheduled.statusCode, 200, scheduled.body);
    const rows = await f.schedules(); assert.equal(rows[0]!.status, 'SCHEDULED'); assert.equal(rows[0]!.decision_revision, 3);
  });
}

test('P5 SERIES follows chosen local time and timezone for later occurrences', async t => {
  const ctx = await setupTest(); t.after(ctx.close); const f = await fixture(ctx, true, 'SERIES', false);
  const chosenTimeSpec = { timeZone: 'America/New_York', localDate: '2030-01-15', localTime: '18:30',
    effectiveAtEpochMs: Date.UTC(2030, 0, 15, 23, 30) };
  const accepted = await f.operation('respondToAlarm', { decision: 'ACCEPTED', consentScope: 'SERIES', chosenTimeSpec },
    { expectedRequestVersion: 1, expectedDecisionRevision: 1 });
  assert.equal(accepted.statusCode, 200, accepted.body);
  for (const [time, expected] of [
    [chosenTimeSpec.effectiveAtEpochMs + 7 * 86400000, 200],
    [FUTURE_TIME.effectiveAtEpochMs + 7 * 86400000, 400],
    [chosenTimeSpec.effectiveAtEpochMs + 7 * 86400000 - 3600000, 400],
  ]) {
    const report = await f.report('SCHEDULED', { occurrenceId: `occ-${time}`, effectiveAtEpochMs: time });
    assert.equal(report.statusCode, expected, report.body);
  }
});

test('P5 normalized alarm list and sync hide old-primary history without deleting it', async t => {
  const ctx = await setupTest(); t.after(ctx.close); const f = await fixture(ctx);
  assert.equal((await f.report('SCHEDULED')).statusCode, 200);
  const replacement = await registerDevice(ctx.app, f.receiver);
  const primary = await ctx.app.inject({ method: 'POST', url: `/v1/devices/${replacement.deviceId}/primary`, headers: auth(f.receiver.token) });
  assert.equal(primary.statusCode, 200, primary.body);
  const list = await ctx.app.inject({ method: 'GET', url: `/v1/groups/${f.groupId}/alarms`, headers: auth(f.sender.token) });
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().alarms.length, 1); assert.deepEqual(list.json().alarms[0].schedules, []);
  const sync = await ctx.app.inject({ method: 'GET', url: '/v1/sync?projection=alarms', headers: auth(f.receiver.token) });
  assert.equal(sync.statusCode, 200, sync.body);
  const events = sync.json().events.filter((event: { kind: string }) => event.kind === 'upsert');
  assert.ok(events.length > 0);
  for (const event of events) assert.deepEqual(event.alarm.schedules, []);
  const history = ctx.db.prepare('SELECT COUNT(*) AS count FROM device_schedules WHERE request_id=?').get(f.requestId) as { count: number };
  assert.equal(history.count, 1);
});
