import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setupTest,
  registerUser,
  createGroup,
  inviteAndJoin,
  createAlarm,
  auth,
  createAlarmBody,
  operationId,
} from './helpers.ts';
import {
  parseAlarmRequestDocument,
  parseRecipientDocument,
  parseScheduleDocument,
} from '../../src/domain/contracts/validate.ts';
import { readAlarmProjection } from '../src/compat/alarms.ts';
test('normalized projection uses canonical SQLite with private cursors and valid consent DTOs', async () => {
  const ctx = await setupTest({ fileDatabase: true });
  try {
    const a = await registerUser(ctx.app, 'Emisor'),
      b = await registerUser(ctx.app, 'Ana'),
      c = await registerUser(ctx.app, 'C');
    const group = await createGroup(ctx.app, a);
    await inviteAndJoin(ctx.app, a, group, b);
    await inviteAndJoin(ctx.app, a, group, c);
    const requestId = await createAlarm(ctx.app, a, group, [b.uid]);
    const page = (
      await ctx.app.inject({ url: '/v1/sync?projection=alarms', headers: auth(b.token) })
    ).json();
    assert.equal(page.events.length, 1);
    const record = page.events[0].alarm;
    parseAlarmRequestDocument(record.request);
    parseRecipientDocument(record.recipient);
    assert.equal(record.requestId, requestId);
    assert.equal(record.recipient.receivedVersion, 1);
    assert.equal(
      (await ctx.app.inject({ url: '/v1/sync?projection=alarms', headers: auth(c.token) })).json()
        .events.length,
      0,
    );
    const foreignCursor = await ctx.app.inject({
      url: `/v1/sync?projection=alarms&cursor=${page.nextCursor}`, headers: auth(c.token),
    });
    assert.equal(foreignCursor.statusCode, 409);
    assert.equal(foreignCursor.json().code, 'EXPIRED');
    assert.equal(foreignCursor.json().events, undefined);
    const obsolete = readAlarmProjection(ctx.db, b.uid, null);
    ctx.db.prepare('DELETE FROM alarm_projection_cursors WHERE token=?').run(obsolete.nextCursor);
    const prunedCursor = await ctx.app.inject({
      url: `/v1/sync?projection=alarms&cursor=${obsolete.nextCursor}`, headers: auth(b.token),
    });
    assert.equal(prunedCursor.statusCode, 409);
    assert.equal(prunedCursor.json().code, foreignCursor.json().code);
    assert.equal(prunedCursor.json().message, foreignCursor.json().message);
    assert.equal((await ctx.app.inject({url:'/v1/sync?projection=alarms&cursor=malformed',headers:auth(b.token)})).statusCode,400);
    const accept = await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/respondToAlarm',
      headers: auth(b.token),
      payload: {
        schemaVersion: 1,
        operationId: operationId(),
        groupId: group,
        entityId: requestId,
        expectedRequestVersion: 1,
        expectedDecisionRevision: 1,
        payload: { decision: 'ACCEPTED', consentScope: 'THIS_OCCURRENCE' },
      },
    });
    assert.equal(accept.statusCode, 200, accept.body);
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/withdrawAlarmRequest',
      headers: auth(a.token),
      payload: {
        schemaVersion: 1,
        operationId: operationId(),
        groupId: group,
        entityId: requestId,
        expectedRequestVersion: 1,
        payload: { reason: 'terminada' },
      },
    });
    const withdrawn = (
      await ctx.app.inject({ url: `/v1/groups/${group}/alarms`, headers: auth(a.token) })
    ).json().alarms[0];
    parseRecipientDocument(withdrawn.recipient);
    assert.equal(withdrawn.recipient.decision, 'NEEDS_REVIEW');
    assert.equal(withdrawn.recipient.consentScope, undefined);
    assert.equal(withdrawn.request.status, 'WITHDRAWN');
    withdrawn.schedules.forEach(parseScheduleDocument);
    const device = (
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/devices',
        headers: auth(b.token),
        payload: { deviceId: 'b-device', platform: 'android' },
      })
    ).json();
    assert.equal(device.deviceEpoch, 1);
    const repeat = (
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/devices/primary',
        headers: auth(b.token),
        payload: { deviceId: 'b-device' },
      })
    ).json();
    assert.equal(repeat.deviceEpoch, 1);
    assert.equal(
      (
        await ctx.app.inject({
          url: `/v1/sync?projection=alarms&cursor=${page.nextCursor}`,
          headers: auth(b.token),
        })
      )
        .json()
        .events.at(-1).alarm.primaryDevice.deviceId,
      'b-device',
    );
    assert.throws(
      () => readAlarmProjection(ctx.db, b.uid, page.nextCursor, 100, Date.now() + 8 * 86400000),
      /caducó/,
    );
    await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/groups/${group}/members/${b.uid}`,
      headers: auth(a.token),
    });
    const revoked = (
      await ctx.app.inject({
        url: `/v1/sync?projection=alarms&cursor=${page.nextCursor}`,
        headers: auth(b.token),
      })
    ).json();
    assert.ok(revoked.events.every((e: { kind: string }) => e.kind === 'revoke'));
    const revokedSnapshot = readAlarmProjection(ctx.db, b.uid, null);
    assert.ok(revokedSnapshot.events.length > 0);
    assert.ok(revokedSnapshot.events.every(event => event.kind === 'revoke'), 'reset preserves group revocations');
    await inviteAndJoin(ctx.app, a, group, b);
    const rejoined = (
      await ctx.app.inject({
        url: `/v1/sync?projection=alarms&cursor=${revoked.nextCursor}`,
        headers: auth(b.token),
      })
    ).json();
    assert.ok(rejoined.events.some((e: { kind: string }) => e.kind === 'upsert'));
  } finally {
    await ctx.close();
  }
});
test('task idempotency/version checks and linked withdrawal share the canonical transaction', async () => {
  const ctx = await setupTest({ fileDatabase: true });
  try {
    const a = await registerUser(ctx.app, 'A'),
      b = await registerUser(ctx.app, 'B'),
      outside = await registerUser(ctx.app, 'C');
    const group = await createGroup(ctx.app, a);
    await inviteAndJoin(ctx.app, a, group, b);
    const payload = {
      operationId: operationId(),
      title: 'Limpiar cocina',
      assigneeUid: a.uid,
      activateAtEpochMs: null,
      dueAtEpochMs: null,
    };
    const create = () =>
      ctx.app.inject({
        method: 'POST',
        url: `/v1/groups/${group}/tasks`,
        headers: auth(a.token),
        payload,
      });
    const [one, two] = await Promise.all([create(), create()]);
    assert.equal(one.statusCode, 200, one.body);
    assert.deepEqual(one.json(), two.json());
    const task = one.json();
    const proposal = createAlarmBody({ groupId: group, recipientUids: [b.uid] });
    (proposal.payload as Record<string, unknown>).taskId = task.id;
    const alarm = await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/createAlarmRequest',
      headers: auth(a.token),
      payload: proposal,
    });
    assert.equal(alarm.statusCode, 200, alarm.body);
    const update = { operationId: operationId(), status: 'completed', expectedVersion: 1 };
    const finish = () =>
      ctx.app.inject({
        method: 'POST',
        url: `/v1/groups/${group}/tasks/${task.id}`,
        headers: auth(b.token),
        payload: update,
      });
    const done = await finish();
    assert.equal(done.statusCode, 200, done.body);
    assert.equal(done.json().version, 2);
    assert.deepEqual((await finish()).json(), done.json());
    assert.equal(
      (
        ctx.db
          .prepare('SELECT status FROM alarm_requests WHERE id=?')
          .get(alarm.json().result.requestId) as { status: string }
      ).status,
      'WITHDRAWN',
    );
    assert.equal(
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/v1/groups/${group}/tasks`,
          headers: auth(outside.token),
        })
      ).statusCode,
      404,
    );
    const reopenUrl = `/v1/groups/${group}/tasks/${task.id}`;
    const reopenPayload = { operationId: operationId(), status: 'pending', expectedVersion: 2 };
    const stale = await ctx.app.inject({ method: 'POST', url: reopenUrl, headers: auth(a.token), payload: { ...reopenPayload, operationId: operationId(), expectedVersion: 1 } });
    assert.equal(stale.statusCode, 409);
    const forbidden = await ctx.app.inject({ method: 'POST', url: reopenUrl, headers: auth(outside.token), payload: reopenPayload });
    assert.equal(forbidden.statusCode, 404);
    const alarmBefore = ctx.db.prepare('SELECT * FROM alarm_requests WHERE id=?').get(alarm.json().result.requestId);
    const recipientsBefore = ctx.db.prepare('SELECT * FROM alarm_recipients WHERE request_id=?').all(alarm.json().result.requestId);
    const reopened = await ctx.app.inject({ method: 'POST', url: reopenUrl, headers: auth(a.token), payload: reopenPayload });
    assert.equal(reopened.statusCode, 200, reopened.body);
    assert.equal(reopened.json().status, 'pending');
    assert.equal(reopened.json().version, 3);
    assert.equal(reopened.json().completedByUid, null);
    assert.equal(reopened.json().completedAtEpochMs, null);
    assert.deepEqual((await ctx.app.inject({ method: 'POST', url: reopenUrl, headers: auth(a.token), payload: reopenPayload })).json(), reopened.json());
    assert.deepEqual(ctx.db.prepare('SELECT * FROM alarm_requests WHERE id=?').get(alarm.json().result.requestId), alarmBefore);
    assert.deepEqual(ctx.db.prepare('SELECT * FROM alarm_recipients WHERE request_id=?').all(alarm.json().result.requestId), recipientsBefore);
    const listed = (await ctx.app.inject({ url: `/v1/groups/${group}/tasks`, headers: auth(b.token) })).json().tasks;
    assert.deepEqual(listed.find((item: { id: string }) => item.id === task.id), reopened.json());
    const finishedAgain = await ctx.app.inject({ method: 'POST', url: reopenUrl, headers: auth(b.token), payload: { operationId: operationId(), status: 'completed', expectedVersion: 3 } });
    assert.equal(finishedAgain.statusCode, 200, finishedAgain.body);
    assert.equal(finishedAgain.json().version, 4);
    assert.equal(finishedAgain.json().completedByUid, b.uid);
    const changed = await ctx.app.inject({
      method: 'POST',
      url: `/v1/groups/${group}/tasks`,
      headers: auth(a.token),
      payload: { ...payload, title: 'Reused id' },
    });
    assert.equal(changed.statusCode, 409);
  } finally {
    await ctx.close();
  }
});

test('task descriptions and categories persist with optional legacy input and validation', async () => {
  const ctx = await setupTest({ fileDatabase: true });
  try {
    const owner = await registerUser(ctx.app);
    const groupId = await createGroup(ctx.app, owner);
    const url = `/v1/groups/${groupId}/tasks`;
    const headers = auth(owner.token);
    const payload = { operationId: operationId(), title: 'Limpiar cocina',
      description: 'Limpiar encimera y sacar la basura.', category: 'Limpieza' };
    const created = await ctx.app.inject({ method: 'POST', url, headers, payload });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal(created.json().description, payload.description);
    assert.equal(created.json().category, payload.category);
    assert.deepEqual((await ctx.app.inject({ method: 'POST', url, headers, payload })).json(), created.json());
    const legacy = await ctx.app.inject({ method: 'POST', url, headers,
      payload: { operationId: operationId(), title: 'Otra tarea' } });
    assert.equal(legacy.json().description, null);
    assert.equal(legacy.json().category, null);
    const tasks = (await ctx.app.inject({ url, headers })).json().tasks;
    assert.deepEqual(tasks.find((task: { id: string }) => task.id === created.json().id), created.json());
    assert.equal((await ctx.app.inject({ method: 'POST', url, headers,
      payload: { ...payload, operationId: operationId(), description: 'x'.repeat(2001) } })).statusCode, 400);
    assert.equal((await ctx.app.inject({ method: 'POST', url, headers,
      payload: { ...payload, operationId: operationId(), category: { unexpected: true } } })).statusCode, 400);
  } finally { await ctx.close(); }
});
