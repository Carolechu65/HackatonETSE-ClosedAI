import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseAlarmRequestDetail,
  parseAlarmRequestPage,
  parseAuthResponse,
  parseMeResponse,
  parseScheduleDocument,
  parseSyncPage,
} from '../../src/domain/contracts/validate.ts';
import {
  FUTURE_TIME,
  auth,
  createAlarm,
  createGroup,
  inviteAndJoin,
  registerDevice,
  registerUser,
  setupTest,
} from './helpers.ts';

test('las respuestas reales del servidor cumplen los contratos v1', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);

    // Registro/login/me
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: owner.email, password: 'correct horse battery staple' },
    });
    assert.equal(login.statusCode, 200);
    const parsedLogin = parseAuthResponse(login.json());
    assert.equal(parsedLogin.user.uid, owner.uid);

    const me = await ctx.app.inject({ method: 'GET', url: '/v1/auth/me', headers: auth(owner.token) });
    assert.equal(me.statusCode, 200);
    assert.equal(parseMeResponse(me.json()).user.uid, owner.uid);

    // Propuesta y decisión
    const requestId = await createAlarm(ctx.app, owner, groupId, [recipient.uid]);
    const accepted = await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/respondToAlarm',
      headers: auth(recipient.token),
      payload: {
        schemaVersion: 1,
        operationId: 'op-contract-respond',
        groupId,
        entityId: requestId,
        expectedRequestVersion: 1,
        expectedDecisionRevision: 1,
        payload: { decision: 'ACCEPTED', consentScope: 'THIS_OCCURRENCE' },
      },
    });
    assert.equal(accepted.statusCode, 200);

    // Lista para creador (recipient null) y destinatario (recipient propio)
    const ownerList = await ctx.app.inject({
      method: 'GET',
      url: `/v1/groups/${groupId}/alarm-requests`,
      headers: auth(owner.token),
    });
    assert.equal(ownerList.statusCode, 200);
    const ownerPage = parseAlarmRequestPage(ownerList.json());
    assert.equal(ownerPage.items[0]?.recipient, null);

    const recipientList = await ctx.app.inject({
      method: 'GET',
      url: `/v1/groups/${groupId}/alarm-requests`,
      headers: auth(recipient.token),
    });
    const recipientPage = parseAlarmRequestPage(recipientList.json());
    assert.equal(recipientPage.items[0]?.recipient?.uid, recipient.uid);

    // Detalle para creador: recipient null + lista de destinatarios
    const ownerDetail = await ctx.app.inject({
      method: 'GET',
      url: `/v1/groups/${groupId}/alarm-requests/${requestId}`,
      headers: auth(owner.token),
    });
    const parsedOwnerDetail = parseAlarmRequestDetail(ownerDetail.json());
    assert.equal(parsedOwnerDetail.recipient, null);
    assert.equal(parsedOwnerDetail.recipients?.[0]?.uid, recipient.uid);

    // Detalle para destinatario: sin decisiones de terceros
    const recipientDetail = await ctx.app.inject({
      method: 'GET',
      url: `/v1/groups/${groupId}/alarm-requests/${requestId}`,
      headers: auth(recipient.token),
    });
    const parsedRecipientDetail = parseAlarmRequestDetail(recipientDetail.json());
    assert.equal(parsedRecipientDetail.recipient?.uid, recipient.uid);
    assert.equal(parsedRecipientDetail.recipients, null);

    // Acuse de programación con DTO camelCase
    const device = await registerDevice(ctx.app, recipient);
    const report = await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/reportSchedule',
      headers: auth(recipient.token),
      payload: {
        schemaVersion: 1,
        operationId: 'op-contract-report',
        groupId,
        entityId: requestId,
        payload: {
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
        },
      },
    });
    assert.equal(report.statusCode, 200);
    const afterReport = await ctx.app.inject({
      method: 'GET',
      url: `/v1/groups/${groupId}/alarm-requests/${requestId}`,
      headers: auth(recipient.token),
    });
    const parsedAfterReport = parseAlarmRequestDetail(afterReport.json());
    parseScheduleDocument(parsedAfterReport.schedules[0]);

    // Feed v1
    const snapshot = await ctx.app.inject({ method: 'GET', url: '/v1/snapshot', headers: auth(recipient.token) });
    const sync = await ctx.app.inject({
      method: 'GET',
      url: `/v1/sync?cursor=${encodeURIComponent(snapshot.json().cursor as string)}`,
      headers: auth(recipient.token),
    });
    assert.equal(sync.statusCode, 200);
    const page = parseSyncPage(sync.json());
    assert.ok(page.changes.some((change) => change.entityType === 'ALARM_REQUEST'));
  } finally {
    await ctx.close();
  }
});
