import assert from 'node:assert/strict';
import test from 'node:test';
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

async function respond(
  ctx: Awaited<ReturnType<typeof setupTest>>,
  token: string,
  groupId: string,
  requestId: string,
  payload: Record<string, unknown>,
  versions: { requestVersion: number; decisionRevision: number },
  op = operationId('respond'),
) {
  return ctx.app.inject({
    method: 'POST',
    url: '/v1/operations/respondToAlarm',
    headers: auth(token),
    payload: {
      schemaVersion: 1,
      operationId: op,
      groupId,
      entityId: requestId,
      expectedRequestVersion: versions.requestVersion,
      expectedDecisionRevision: versions.decisionRevision,
      payload,
    },
  });
}

async function reportSchedule(
  ctx: Awaited<ReturnType<typeof setupTest>>,
  token: string,
  groupId: string,
  requestId: string,
  payload: Record<string, unknown>,
  op = operationId('report'),
) {
  return ctx.app.inject({
    method: 'POST',
    url: '/v1/operations/reportSchedule',
    headers: auth(token),
    payload: {
      schemaVersion: 1,
      operationId: op,
      groupId,
      entityId: requestId,
      payload,
    },
  });
}

test('A propone, B acepta y programa, C no puede acceder', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const neighbor = await registerUser(ctx.app, 'Vecino');
    const outsider = await registerUser(ctx.app, 'Ajeno');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);
    await inviteAndJoin(ctx.app, owner, groupId, neighbor);

    const requestId = await createAlarm(ctx.app, owner, groupId, [recipient.uid]);

    const outsiderList = await ctx.app.inject({
      method: 'GET',
      url: `/v1/groups/${groupId}/alarm-requests`,
      headers: auth(outsider.token),
    });
    assert.equal(outsiderList.statusCode, 404);

    const neighborList = await ctx.app.inject({
      method: 'GET',
      url: `/v1/groups/${groupId}/alarm-requests`,
      headers: auth(neighbor.token),
    });
    assert.equal(neighborList.statusCode, 200);
    assert.equal(neighborList.json().items.length, 0);

    const neighborDetail = await ctx.app.inject({
      method: 'GET',
      url: `/v1/groups/${groupId}/alarm-requests/${requestId}`,
      headers: auth(neighbor.token),
    });
    assert.equal(neighborDetail.statusCode, 404);

    const neighborRespond = await respond(
      ctx,
      neighbor.token,
      groupId,
      requestId,
      { decision: 'ACCEPTED', consentScope: 'THIS_OCCURRENCE' },
      { requestVersion: 1, decisionRevision: 1 },
    );
    assert.equal(neighborRespond.statusCode, 403);

    const accepted = await respond(
      ctx,
      recipient.token,
      groupId,
      requestId,
      { decision: 'ACCEPTED', consentScope: 'THIS_OCCURRENCE' },
      { requestVersion: 1, decisionRevision: 1 },
    );
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.json().status, 'APPLIED');
    assert.equal(accepted.json().decisionRevision, 2);

    const detailForRecipient = await ctx.app.inject({
      method: 'GET',
      url: `/v1/groups/${groupId}/alarm-requests/${requestId}`,
      headers: auth(recipient.token),
    });
    assert.equal(detailForRecipient.json().recipient.decision, 'ACCEPTED');
    assert.equal(detailForRecipient.json().recipient.decisionRevision, 2);
    assert.equal(detailForRecipient.json().recipients, null);

    const detailForOwner = await ctx.app.inject({
      method: 'GET',
      url: `/v1/groups/${groupId}/alarm-requests/${requestId}`,
      headers: auth(owner.token),
    });
    assert.equal(detailForOwner.statusCode, 200);
    assert.equal(detailForOwner.json().recipients[0].decision, 'ACCEPTED');
    assert.equal(detailForOwner.json().request.recipientUids.length, 1);

    const device = await registerDevice(ctx.app, recipient);
    assert.equal(device.deviceEpoch, 1);

    const reported = await reportSchedule(ctx, recipient.token, groupId, requestId, {
      occurrenceId: `occ-${FUTURE_TIME.effectiveAtEpochMs}`,
      deviceId: device.deviceId,
      deviceEpoch: device.deviceEpoch,
      requestVersion: 1,
      decisionRevision: 2,
      mode: 'ALARM',
      mechanism: 'ALARM_RUNTIME',
      status: 'SCHEDULED',
      effectiveAtEpochMs: FUTURE_TIME.effectiveAtEpochMs,
      reportedAtEpochMs: Date.now(),
    });
    assert.equal(reported.statusCode, 200);
    assert.equal(reported.json().result.status, 'SCHEDULED');

    const schedules = await ctx.app.inject({
      method: 'GET',
      url: `/v1/groups/${groupId}/alarm-requests/${requestId}/schedules`,
      headers: auth(owner.token),
    });
    assert.equal(schedules.statusCode, 200);
    assert.equal(schedules.json().schedules.length, 1);
    assert.equal(schedules.json().schedules[0].status, 'SCHEDULED');
  } finally {
    await ctx.close();
  }
});

test('idempotencia: mismo operationId devuelve REPLAYED; payload distinto falla', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);

    const body = createAlarmBody({ groupId, recipientUids: [recipient.uid], operationId: 'op-fixed-create' });
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/createAlarmRequest',
      headers: auth(owner.token),
      payload: body,
    });
    const second = await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/createAlarmRequest',
      headers: auth(owner.token),
      payload: body,
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().status, 'APPLIED');
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().status, 'REPLAYED');
    assert.equal(second.json().result.requestId, first.json().result.requestId);

    const count = ctx.db.prepare('SELECT COUNT(*) AS count FROM alarm_requests').get() as { count: number };
    assert.equal(count.count, 1);

    const changed = { ...body, payload: { ...(body.payload as Record<string, unknown>), title: 'Otro título' } };
    const conflict = await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/createAlarmRequest',
      headers: auth(owner.token),
      payload: changed,
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().code, 'VERSION_CONFLICT');
  } finally {
    await ctx.close();
  }
});

test('dos llamadas concurrentes con el mismo operationId producen un solo efecto', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);
    const body = createAlarmBody({ groupId, recipientUids: [recipient.uid], operationId: 'op-concurrent' });

    const [one, two] = await Promise.all([
      ctx.app.inject({ method: 'POST', url: '/v1/operations/createAlarmRequest', headers: auth(owner.token), payload: body }),
      ctx.app.inject({ method: 'POST', url: '/v1/operations/createAlarmRequest', headers: auth(owner.token), payload: body }),
    ]);
    assert.deepEqual([one.statusCode, two.statusCode], [200, 200]);
    assert.deepEqual([one.json().status, two.json().status].sort(), ['APPLIED', 'REPLAYED']);
    const count = ctx.db.prepare('SELECT COUNT(*) AS count FROM alarm_requests').get() as { count: number };
    assert.equal(count.count, 1);
  } finally {
    await ctx.close();
  }
});

test('versión obsoleta y respuesta del creador se rechazan', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);
    const requestId = await createAlarm(ctx.app, owner, groupId, [recipient.uid]);

    const accepted = await respond(
      ctx,
      recipient.token,
      groupId,
      requestId,
      { decision: 'ACCEPTED', consentScope: 'THIS_OCCURRENCE' },
      { requestVersion: 1, decisionRevision: 1 },
    );
    assert.equal(accepted.statusCode, 200);

    const stale = await respond(
      ctx,
      recipient.token,
      groupId,
      requestId,
      { decision: 'REJECTED' },
      { requestVersion: 1, decisionRevision: 1 },
    );
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().code, 'VERSION_CONFLICT');

    const creatorResponds = await respond(
      ctx,
      owner.token,
      groupId,
      requestId,
      { decision: 'ACCEPTED', consentScope: 'THIS_OCCURRENCE' },
      { requestVersion: 1, decisionRevision: 1 },
    );
    assert.equal(creatorResponds.statusCode, 403);
  } finally {
    await ctx.close();
  }
});

test('retirar invalida el consentimiento y el acuse posterior falla', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);
    const requestId = await createAlarm(ctx.app, owner, groupId, [recipient.uid]);
    await respond(
      ctx,
      recipient.token,
      groupId,
      requestId,
      { decision: 'ACCEPTED', consentScope: 'THIS_OCCURRENCE' },
      { requestVersion: 1, decisionRevision: 1 },
    );
    const device = await registerDevice(ctx.app, recipient);

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
        payload: { reason: 'Al final lo hace la vecina.' },
      },
    });
    assert.equal(withdraw.statusCode, 200);

    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/v1/groups/${groupId}/alarm-requests/${requestId}`,
      headers: auth(recipient.token),
    });
    assert.equal(detail.json().request.status, 'WITHDRAWN');
    assert.equal(detail.json().recipient.decision, 'NEEDS_REVIEW');
    assert.equal(detail.json().recipient.decisionRevision, 3);

    const report = await reportSchedule(ctx, recipient.token, groupId, requestId, {
      occurrenceId: `occ-${FUTURE_TIME.effectiveAtEpochMs}`,
      deviceId: device.deviceId,
      deviceEpoch: device.deviceEpoch,
      requestVersion: 1,
      decisionRevision: 3,
      mode: 'ALARM',
      mechanism: 'ALARM_RUNTIME',
      status: 'SCHEDULED',
      effectiveAtEpochMs: FUTURE_TIME.effectiveAtEpochMs,
      reportedAtEpochMs: Date.now(),
    });
    assert.equal(report.statusCode, 409);
    assert.equal(report.json().code, 'EXPIRED');
  } finally {
    await ctx.close();
  }
});

test('un ACK antiguo no revive una cancelación y el epoch viejo no programa', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);
    const requestId = await createAlarm(ctx.app, owner, groupId, [recipient.uid]);
    await respond(
      ctx,
      recipient.token,
      groupId,
      requestId,
      { decision: 'ACCEPTED', consentScope: 'THIS_OCCURRENCE' },
      { requestVersion: 1, decisionRevision: 1 },
    );
    const device = await registerDevice(ctx.app, recipient);
    const base = {
      occurrenceId: `occ-${FUTURE_TIME.effectiveAtEpochMs}`,
      deviceId: device.deviceId,
      deviceEpoch: 1,
      requestVersion: 1,
      decisionRevision: 2,
      mode: 'ALARM',
      mechanism: 'ALARM_RUNTIME',
      effectiveAtEpochMs: FUTURE_TIME.effectiveAtEpochMs,
    };

    const cancelled = await reportSchedule(ctx, recipient.token, groupId, requestId, {
      ...base,
      status: 'CANCELLED',
      reportedAtEpochMs: Date.now() + 1_000,
    });
    assert.equal(cancelled.statusCode, 200);

    const stale = await reportSchedule(ctx, recipient.token, groupId, requestId, {
      ...base,
      status: 'SCHEDULED',
      reportedAtEpochMs: Date.now(),
    });
    assert.equal(stale.statusCode, 200);
    assert.equal(stale.json().result.ignored, true);
    assert.equal(stale.json().result.status, 'CANCELLED');

    const schedules = await ctx.app.inject({
      method: 'GET',
      url: `/v1/groups/${groupId}/alarm-requests/${requestId}/schedules`,
      headers: auth(recipient.token),
    });
    assert.equal(schedules.json().schedules[0].status, 'CANCELLED');

    await ctx.app.inject({
      method: 'POST',
      url: `/v1/devices/${device.deviceId}/primary`,
      headers: auth(recipient.token),
    });
    const oldEpoch = await reportSchedule(ctx, recipient.token, groupId, requestId, {
      ...base,
      status: 'SCHEDULED',
      reportedAtEpochMs: Date.now(),
    });
    assert.equal(oldEpoch.statusCode, 403);
    assert.equal(oldEpoch.json().code, 'DEVICE_NOT_PRIMARY');
  } finally {
    await ctx.close();
  }
});

test('destinatario ajeno, duplicado o recurrencia inconsistente se rechazan', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const outsider = await registerUser(ctx.app, 'Ajeno');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);

    const outside = await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/createAlarmRequest',
      headers: auth(owner.token),
      payload: createAlarmBody({ groupId, recipientUids: [outsider.uid] }),
    });
    assert.equal(outside.statusCode, 403);

    const duplicate = await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/createAlarmRequest',
      headers: auth(owner.token),
      payload: createAlarmBody({ groupId, recipientUids: [recipient.uid, recipient.uid] }),
    });
    assert.equal(duplicate.statusCode, 400);

    const body = createAlarmBody({ groupId, recipientUids: [recipient.uid] });
    (body.payload as Record<string, unknown>).recurrence = { kind: 'WEEKLY', isoWeekday: 2, localTime: '20:00' };
    const mismatch = await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/createAlarmRequest',
      headers: auth(owner.token),
      payload: body,
    });
    assert.equal(mismatch.statusCode, 400);
  } finally {
    await ctx.close();
  }
});
