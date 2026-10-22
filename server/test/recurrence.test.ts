import assert from 'node:assert/strict';
import test from 'node:test';
import { nextWeeklyOccurrence } from '../../src/domain/time.ts';
import {
  FUTURE_TIME,
  auth,
  createAlarmBody,
  createGroup,
  inviteAndJoin,
  operationId,
  registerDevice,
  registerUser,
  setupTest,
} from './helpers.ts';

test('una serie semanal acepta y reporta ocurrencias posteriores', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);

    const body = createAlarmBody({ groupId, recipientUids: [recipient.uid] });
    (body.payload as Record<string, unknown>).recurrence = {
      kind: 'WEEKLY',
      isoWeekday: 2,
      localTime: '21:00',
    };
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/createAlarmRequest',
      headers: auth(owner.token),
      payload: body,
    });
    assert.equal(created.statusCode, 200);
    const requestId = (created.json() as { result: { requestId: string } }).result.requestId;

    const accepted = await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/respondToAlarm',
      headers: auth(recipient.token),
      payload: {
        schemaVersion: 1,
        operationId: operationId('respond'),
        groupId,
        entityId: requestId,
        expectedRequestVersion: 1,
        expectedDecisionRevision: 1,
        payload: { decision: 'ACCEPTED', consentScope: 'SERIES' },
      },
    });
    assert.equal(accepted.statusCode, 200);

    const device = await registerDevice(ctx.app, recipient);
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/reportSchedule',
      headers: auth(recipient.token),
      payload: {
        schemaVersion: 1,
        operationId: operationId('report-first'),
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
    assert.equal(first.statusCode, 200);

    const next = nextWeeklyOccurrence(
      { kind: 'WEEKLY', isoWeekday: 2, localTime: '21:00' },
      'Europe/Madrid',
      FUTURE_TIME.effectiveAtEpochMs,
    );
    assert.ok(next !== null);
    const second = await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/reportSchedule',
      headers: auth(recipient.token),
      payload: {
        schemaVersion: 1,
        operationId: operationId('report-second'),
        groupId,
        entityId: requestId,
        payload: {
          occurrenceId: `occ-${next}`,
          deviceId: device.deviceId,
          deviceEpoch: device.deviceEpoch,
          requestVersion: 1,
          decisionRevision: 2,
          mode: 'ALARM',
          mechanism: 'ALARM_RUNTIME',
          status: 'SCHEDULED',
          effectiveAtEpochMs: next,
          reportedAtEpochMs: Date.now(),
        },
      },
    });
    assert.equal(second.statusCode, 200);

    const rows = ctx.db.prepare('SELECT occurrence_id, status FROM device_schedules ORDER BY effective_at_epoch_ms').all() as Array<{
      occurrence_id: string;
      status: string;
    }>;
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.status), ['SCHEDULED', 'SCHEDULED']);
  } finally {
    await ctx.close();
  }
});
