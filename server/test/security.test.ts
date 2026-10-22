import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimeSpec, wallClockInZone } from '../../src/domain/time.ts';
import { OutboxWorker } from '../src/messaging/outboxWorker.ts';
import { RecordingPushSender } from '../src/messaging/push.ts';
import {
  FUTURE_TIME,
  auth,
  createAlarm,
  createAlarmBody,
  createGroup,
  inviteAndJoin,
  operationId,
  registerDevice,
  registerUser,
  setupTest,
} from './helpers.ts';

async function accept(
  ctx: Awaited<ReturnType<typeof setupTest>>,
  token: string,
  groupId: string,
  requestId: string,
  consentScope: 'THIS_OCCURRENCE' | 'SERIES' = 'THIS_OCCURRENCE',
) {
  return ctx.app.inject({
    method: 'POST',
    url: '/v1/operations/respondToAlarm',
    headers: auth(token),
    payload: {
      schemaVersion: 1,
      operationId: operationId('respond'),
      groupId,
      entityId: requestId,
      expectedRequestVersion: 1,
      expectedDecisionRevision: 1,
      payload: { decision: 'ACCEPTED', consentScope },
    },
  });
}

async function report(
  ctx: Awaited<ReturnType<typeof setupTest>>,
  token: string,
  groupId: string,
  requestId: string,
  payload: Record<string, unknown>,
) {
  return ctx.app.inject({
    method: 'POST',
    url: '/v1/operations/reportSchedule',
    headers: auth(token),
    payload: {
      schemaVersion: 1,
      operationId: operationId('report'),
      groupId,
      entityId: requestId,
      payload,
    },
  });
}

test('un miembro retirado no puede confirmar recepción ni recibir push', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);
    await registerDevice(ctx.app, recipient, 'ExponentPushToken[removed-member]');
    const requestId = await createAlarm(ctx.app, owner, groupId, [recipient.uid]);

    const removal = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/groups/${groupId}/members/${recipient.uid}`,
      headers: auth(owner.token),
    });
    assert.equal(removal.statusCode, 200);

    const ack = await ctx.app.inject({
      method: 'POST',
      url: `/v1/alarms/${requestId}/received`,
      headers: auth(recipient.token),
      payload: { requestVersion: 1 },
    });
    assert.equal(ack.statusCode, 404);

    const sender = new RecordingPushSender({ ok: true });
    const result = await new OutboxWorker(ctx.db, sender, { pollIntervalMs: 10_000, leaseMs: 5_000 }).runOnce();
    assert.equal(result.delivered, false);
    assert.equal(result.error, 'not_authorized');
    assert.equal(sender.sent.length, 0);
    const row = ctx.db.prepare('SELECT delivered_at_epoch_ms, last_error FROM outbox_events').get() as {
      delivered_at_epoch_ms: number | null;
      last_error: string;
    };
    assert.ok(row.delivered_at_epoch_ms);
    assert.equal(row.last_error, 'not_authorized');
  } finally {
    await ctx.close();
  }
});

test('el push no incluye títulos, notas ni motivos privados', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);
    await registerDevice(ctx.app, recipient, 'ExponentPushToken[privacy]');
    const requestId = await createAlarm(ctx.app, owner, groupId, [recipient.uid]);

    const withdraw = await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/withdrawAlarmRequest',
      headers: auth(owner.token),
      payload: {
        schemaVersion: 1,
        operationId: operationId('withdraw'),
        groupId,
        entityId: requestId,
        expectedRequestVersion: 1,
        payload: { reason: 'Motivo privado 456' },
      },
    });
    assert.equal(withdraw.statusCode, 200);

    const sender = new RecordingPushSender({ ok: true });
    const worker = new OutboxWorker(ctx.db, sender, { pollIntervalMs: 10_000, leaseMs: 5_000 });
    for (let index = 0; index < 10; index += 1) {
      const result = await worker.runOnce();
      if (!result.processed) break;
    }
    const serialized = JSON.stringify(sender.sent);
    assert.equal(serialized.includes('Sacar la basura'), false);
    assert.equal(serialized.includes('La bolsa pesa'), false);
    assert.equal(serialized.includes('Motivo privado 456'), false);
    for (const message of sender.sent) {
      assert.equal('hint' in message.data, false);
    }
  } finally {
    await ctx.close();
  }
});

test('dos registros simultáneos del mismo correo no producen 500', async () => {
  const ctx = await setupTest();
  try {
    const payload = {
      email: 'race@example.test',
      password: 'correct horse battery staple',
      displayName: 'Race',
    };
    const [one, two] = await Promise.all([
      ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload }),
      ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload }),
    ]);
    assert.deepEqual([one.statusCode, two.statusCode].sort(), [201, 400]);
  } finally {
    await ctx.close();
  }
});

test('SERIES exige una propuesta semanal', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);
    const requestId = await createAlarm(ctx.app, owner, groupId, [recipient.uid]);
    const response = await accept(ctx, recipient.token, groupId, requestId, 'SERIES');
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'INVALID_ARGUMENT');
  } finally {
    await ctx.close();
  }
});

test('un acuse no hace retroceder un estado no terminal', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);
    const requestId = await createAlarm(ctx.app, owner, groupId, [recipient.uid]);
    await accept(ctx, recipient.token, groupId, requestId);
    const device = await registerDevice(ctx.app, recipient);
    const base = {
      occurrenceId: `occ-${FUTURE_TIME.effectiveAtEpochMs}`,
      deviceId: device.deviceId,
      deviceEpoch: device.deviceEpoch,
      requestVersion: 1,
      decisionRevision: 2,
      mode: 'ALARM',
      mechanism: 'ALARM_RUNTIME',
      effectiveAtEpochMs: FUTURE_TIME.effectiveAtEpochMs,
    };
    const newer = Date.now() + 10_000;
    const scheduled = await report(ctx, recipient.token, groupId, requestId, {
      ...base,
      status: 'SCHEDULED',
      reportedAtEpochMs: newer,
    });
    assert.equal(scheduled.statusCode, 200);

    const older = await report(ctx, recipient.token, groupId, requestId, {
      ...base,
      status: 'SCHEDULING',
      reportedAtEpochMs: Date.now(),
    });
    assert.equal(older.statusCode, 200);
    assert.equal(older.json().result.ignored, true);
    assert.equal(older.json().result.status, 'SCHEDULED');
  } finally {
    await ctx.close();
  }
});

test('FIRED es terminal y no se revive con otro acuse', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);

    const fireAt = Math.ceil((Date.now() + 120_000) / 60_000) * 60_000;
    const local = wallClockInZone(fireAt, 'UTC');
    const timeSpec = createTimeSpec({ timeZone: 'UTC', ...local });
    assert.equal(timeSpec.effectiveAtEpochMs, fireAt);
    const body = createAlarmBody({ groupId, recipientUids: [recipient.uid] });
    (body.payload as Record<string, unknown>).timeSpec = timeSpec;
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/createAlarmRequest',
      headers: auth(owner.token),
      payload: body,
    });
    const requestId = (created.json() as { result: { requestId: string } }).result.requestId;
    await accept(ctx, recipient.token, groupId, requestId);
    const device = await registerDevice(ctx.app, recipient);
    const base = {
      occurrenceId: `occ-${fireAt}`,
      deviceId: device.deviceId,
      deviceEpoch: device.deviceEpoch,
      requestVersion: 1,
      decisionRevision: 2,
      mode: 'ALARM',
      mechanism: 'ALARM_RUNTIME',
      effectiveAtEpochMs: fireAt,
    };
    const fired = await report(ctx, recipient.token, groupId, requestId, {
      ...base,
      status: 'FIRED',
      reportedAtEpochMs: fireAt,
    });
    assert.equal(fired.statusCode, 200);
    const revived = await report(ctx, recipient.token, groupId, requestId, {
      ...base,
      status: 'SCHEDULED',
      reportedAtEpochMs: fireAt + 1_000,
    });
    assert.equal(revived.statusCode, 200);
    assert.equal(revived.json().result.ignored, true);
    assert.equal(revived.json().result.status, 'FIRED');
  } finally {
    await ctx.close();
  }
});

test('outbox keeps the creator authorized for recipient and schedule updates', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);
    await registerDevice(ctx.app, owner, 'ExponentPushToken[creator]');
    const device = await registerDevice(ctx.app, recipient);
    const requestId = await createAlarm(ctx.app, owner, groupId, [recipient.uid]);
    await accept(ctx, recipient.token, groupId, requestId);
    const ack = await report(ctx, recipient.token, groupId, requestId, {
      occurrenceId: `occ-${FUTURE_TIME.effectiveAtEpochMs}`, deviceId: device.deviceId,
      deviceEpoch: device.deviceEpoch, requestVersion: 1, decisionRevision: 2,
      mode: 'ALARM', mechanism: 'ALARM_RUNTIME', status: 'SCHEDULED',
      effectiveAtEpochMs: FUTURE_TIME.effectiveAtEpochMs, reportedAtEpochMs: Date.now(),
    });
    assert.equal(ack.statusCode, 200, ack.body);
    const sender = new RecordingPushSender();
    const worker = new OutboxWorker(ctx.db, sender, { pollIntervalMs: 10_000, leaseMs: 5000 });
    for (let i = 0; i < 10; i++) if (!(await worker.runOnce()).processed) break;
    assert.ok(sender.sent.some(message => message.data.kind === 'alarm_recipient.responded'));
    assert.ok(sender.sent.some(message => message.data.kind === 'schedule.reported'));
    assert.ok(sender.sent.every(message => message.to === 'ExponentPushToken[creator]'));
  } finally { await ctx.close(); }
});

test('outbox stops retrying after ten failures and device registration rejects invalid tokens', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);
    const invalid = await ctx.app.inject({ method: 'POST', url: '/v1/devices', headers: auth(recipient.token),
      payload: { platform: 'android', pushToken: 'invalid-push-token' } });
    assert.equal(invalid.statusCode, 400);
    await registerDevice(ctx.app, recipient, 'ExponentPushToken[retry-test]');
    await createAlarm(ctx.app, owner, groupId, [recipient.uid]);
    const sender = new RecordingPushSender({ ok: false, error: 'test_failure' });
    const worker = new OutboxWorker(ctx.db, sender, { pollIntervalMs: 10_000, leaseMs: 5000 });
    const now = Date.now();
    for (let i = 0; i < 10; i++) assert.equal((await worker.runOnce(now + i * 7_200_000)).processed, true);
    assert.equal((await worker.runOnce(now + 11 * 7_200_000)).processed, false);
    assert.equal(sender.sent.length, 10);
    const row = ctx.db.prepare('SELECT attempts,last_error FROM outbox_events').get() as { attempts: number; last_error: string };
    assert.equal(row.attempts, 10);
    assert.equal(row.last_error, 'max_attempts:test_failure');
  } finally { await ctx.close(); }
});

test('weekly recurrence must match the first local date', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);
    const body = createAlarmBody({ groupId, recipientUids: [recipient.uid] });
    (body.payload as Record<string, unknown>).recurrence = { kind: 'WEEKLY', isoWeekday: 1, localTime: '21:00' };
    const response = await ctx.app.inject({ method: 'POST', url: '/v1/operations/createAlarmRequest',
      headers: auth(owner.token), payload: body });
    assert.equal(response.statusCode, 400);
    assert.equal((ctx.db.prepare('SELECT count(*) AS n FROM alarm_requests').get() as { n: number }).n, 0);
  } finally { await ctx.close(); }
});
