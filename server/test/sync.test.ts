import assert from 'node:assert/strict';
import test from 'node:test';
import { OutboxWorker } from '../src/messaging/outboxWorker.ts';
import { RecordingPushSender } from '../src/messaging/push.ts';
import {
  auth,
  createAlarm,
  createGroup,
  inviteAndJoin,
  registerDevice,
  registerUser,
  setupTest,
} from './helpers.ts';

test('sync entrega solo eventos autorizados y respeta el cursor del actor', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const outsider = await registerUser(ctx.app, 'Ajeno');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);

    const snapshot = await ctx.app.inject({
      method: 'GET',
      url: '/v1/snapshot',
      headers: auth(recipient.token),
    });
    assert.equal(snapshot.statusCode, 200);
    const cursor = snapshot.json().cursor as string;

    const requestId = await createAlarm(ctx.app, owner, groupId, [recipient.uid]);
    const received = await ctx.app.inject({
      method: 'POST',
      url: `/v1/alarms/${requestId}/received`,
      headers: auth(recipient.token),
      payload: { requestVersion: 1 },
    });
    assert.equal(received.statusCode, 200);

    await ctx.app.inject({
      method: 'POST',
      url: '/v1/operations/respondToAlarm',
      headers: auth(recipient.token),
      payload: {
        schemaVersion: 1,
        operationId: 'op-sync-respond',
        groupId,
        entityId: requestId,
        expectedRequestVersion: 1,
        expectedDecisionRevision: 1,
        payload: { decision: 'ACCEPTED', consentScope: 'THIS_OCCURRENCE' },
      },
    });

    const page = await ctx.app.inject({
      method: 'GET',
      url: `/v1/sync?cursor=${encodeURIComponent(cursor)}`,
      headers: auth(recipient.token),
    });
    assert.equal(page.statusCode, 200);
    const changes = page.json().changes as Array<Record<string, unknown>>;
    assert.ok(changes.length >= 2);
    assert.ok(changes.some((event) => event.entityType === 'ALARM_REQUEST'));
    assert.ok(changes.some((event) => event.entityType === 'RECIPIENT'));
    assert.ok(page.json().nextCursor);

    const crossUser = await ctx.app.inject({
      method: 'GET',
      url: `/v1/sync?cursor=${encodeURIComponent(cursor)}`,
      headers: auth(outsider.token),
    });
    assert.equal(crossUser.statusCode, 400);
    assert.equal(crossUser.json().code, 'INVALID_ARGUMENT');

    const invalid = await ctx.app.inject({
      method: 'GET',
      url: '/v1/sync?cursor=not-a-cursor',
      headers: auth(recipient.token),
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await ctx.close();
  }
});

test('la retirada de membresía genera invalidación mínima y corta el acceso', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const member = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, member);

    const snapshot = await ctx.app.inject({
      method: 'GET',
      url: '/v1/snapshot',
      headers: auth(member.token),
    });
    const cursor = snapshot.json().cursor as string;

    const removal = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/groups/${groupId}/members/${member.uid}`,
      headers: auth(owner.token),
    });
    assert.equal(removal.statusCode, 200);

    const page = await ctx.app.inject({
      method: 'GET',
      url: `/v1/sync?cursor=${encodeURIComponent(cursor)}`,
      headers: auth(member.token),
    });
    assert.equal(page.statusCode, 200);
    const revoked = (page.json().changes as Array<Record<string, unknown>>)
      .filter((event) => event.kind === 'DELETE');
    assert.ok(revoked.length >= 1);
    assert.equal(revoked[0]!.entityType, 'GROUP_MEMBERSHIP');
    assert.equal(revoked[0]!.entityId, `${groupId}:${member.uid}`);

    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/v1/groups/${groupId}/alarm-requests`,
      headers: auth(member.token),
    });
    assert.equal(detail.statusCode, 404);
  } finally {
    await ctx.close();
  }
});

test('la outbox persiste tras el commit, reintenta y desactiva tokens inválidos', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);
    await registerDevice(ctx.app, recipient, 'ExponentPushToken[valid-token-1]');
    await createAlarm(ctx.app, owner, groupId, [recipient.uid]);

    const sender = new RecordingPushSender({ ok: true });
    const worker = new OutboxWorker(ctx.db, sender, { pollIntervalMs: 10_000, leaseMs: 5_000 });
    const result = await worker.runOnce();
    assert.equal(result.processed, true);
    assert.equal(result.delivered, true);
    assert.equal(sender.sent.length, 1);
    assert.equal(sender.sent[0]!.data.kind, 'alarm_request.created');
    assert.equal(JSON.stringify(sender.sent[0]!.data).includes('Sacar la basura'), false);

    const noMore = await worker.runOnce();
    assert.equal(noMore.processed, false);

    const pendingBefore = ctx.db
      .prepare('SELECT COUNT(*) AS count FROM outbox_events WHERE delivered_at_epoch_ms IS NULL')
      .get() as { count: number };
    assert.equal(pendingBefore.count, 0);

    await createAlarm(ctx.app, owner, groupId, [recipient.uid]);
    const failing = new RecordingPushSender({ ok: false, error: 'expo_push_network_error' });
    const failingWorker = new OutboxWorker(ctx.db, failing, { pollIntervalMs: 10_000, leaseMs: 5_000 });
    const failed = await failingWorker.runOnce();
    assert.equal(failed.delivered, false);
    const row = ctx.db
      .prepare('SELECT attempts, next_attempt_at_epoch_ms, last_error FROM outbox_events WHERE delivered_at_epoch_ms IS NULL')
      .get() as { attempts: number; next_attempt_at_epoch_ms: number; last_error: string };
    assert.equal(row.attempts, 1);
    assert.equal(row.last_error, 'expo_push_network_error');
    assert.ok(row.next_attempt_at_epoch_ms > Date.now());

    ctx.db.prepare('UPDATE outbox_events SET next_attempt_at_epoch_ms = 0 WHERE delivered_at_epoch_ms IS NULL').run();
    const recovering = new RecordingPushSender({ ok: true, invalidTokens: ['ExponentPushToken[valid-token-1]'] });
    const recovered = await new OutboxWorker(ctx.db, recovering, { pollIntervalMs: 10_000, leaseMs: 5_000 }).runOnce();
    assert.equal(recovered.delivered, true);
    const token = ctx.db
      .prepare("SELECT push_token FROM devices WHERE user_id = ?")
      .get(recipient.uid) as { push_token: string | null };
    assert.equal(token.push_token, null);
  } finally {
    await ctx.close();
  }
});

test('outbox sin tokens se marca como no entregada sin llamar a la red', async () => {
  const ctx = await setupTest();
  try {
    const owner = await registerUser(ctx.app, 'Luis');
    const recipient = await registerUser(ctx.app, 'Ana');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, recipient);
    await createAlarm(ctx.app, owner, groupId, [recipient.uid]);
    const sender = new RecordingPushSender({ ok: true });
    const result = await new OutboxWorker(ctx.db, sender, { pollIntervalMs: 10_000, leaseMs: 5_000 }).runOnce();
    assert.equal(result.delivered, false);
    assert.equal(result.error, 'no_push_token');
    assert.equal(sender.sent.length, 0);
    const row = ctx.db.prepare('SELECT delivered_at_epoch_ms, last_error FROM outbox_events').get() as {
      delivered_at_epoch_ms: number | null;
      last_error: string;
    };
    assert.ok(row.delivered_at_epoch_ms);
    assert.equal(row.last_error, 'no_push_token');
  } finally {
    await ctx.close();
  }
});
