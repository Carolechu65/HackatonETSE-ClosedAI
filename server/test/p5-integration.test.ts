import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { HTTPMethods } from 'fastify';
import { setupTest, registerUser, createGroup, inviteAndJoin } from './helpers.ts';
import { createTimeSpec } from '../../src/domain/time.ts';

const projectRoot = resolve(process.cwd(), '..'); // npm --prefix server test runs from server/
// Temporary opt-in while P5 is integrated; default imports always use this repository.
const p5Client = resolve(process.env.P5_SOURCE_ROOT ?? projectRoot, 'src/data/client.ts');

test('P5 + API SQLite: consent, lost ACK/replay, sender visibility, task withdrawal and logout', {
  skip: !existsSync(p5Client) ? 'P5 not yet merged; set P5_SOURCE_ROOT to integration checkout' : false,
}, async () => {
  const { createDataClient } = await import(pathToFileURL(p5Client).href);
  const { createFakeAlarmRuntime } = await import(pathToFileURL(resolve(projectRoot, 'src/domain/fakes.ts')).href);
  const fixture = await setupTest({ fileDatabase: true });
  const { app, db: remote } = fixture;
  const local = new DatabaseSync(resolve(fixture.dir, 'recipient.sqlite'));
  let now = Date.now();
  const runtime = createFakeAlarmRuntime();
  const secure = new Map<string, string>();
  const widgets: unknown[] = [];
  let online = true, loseFirstAckResponse = true, reportRequests = 0;
  const call = async (method: HTTPMethods, url: string, body?: unknown, token?: string) => {
    const response = await app.inject({ method, url, ...(body === undefined ? {} : { payload: body as object }), headers: token ? { authorization: `Bearer ${token}` } : {} });
    assert.ok(response.statusCode === 200 || response.statusCode === 201, `${method} ${url}: ${response.body}`);
    return response.json();
  };
  const client = createDataClient({
    database: {
      async execAsync(sql: string) { local.exec(sql); },
      async runAsync(sql: string, ...params: (string | number | null)[]) { return { changes: Number(local.prepare(sql).run(...params).changes) }; },
      async getFirstAsync(sql: string, ...params: (string | number | null)[]) { return local.prepare(sql).get(...params) ?? null; },
      async getAllAsync(sql: string, ...params: (string | number | null)[]) { return local.prepare(sql).all(...params); },
      async closeAsync() { local.close(); },
    },
    secureStorage: {
      async getItemAsync(key: string) { return secure.get(key) ?? null; },
      async setItemAsync(key: string, value: string) { secure.set(key, value); },
      async deleteItemAsync(key: string) { secure.delete(key); },
    },
    baseUrl: 'https://api.alarmat.test',
    codec: {
      decodeSession: (value: { user: { uid: string }; session?: { token: string; expiresAtEpochMs: number }; token?: string; expiresAtEpochMs?: number }) => {
        const session = value.session ?? value;
        if (typeof session.token !== 'string' || !Number.isSafeInteger(session.expiresAtEpochMs)) throw new Error('Sesión inválida.');
        return { userId: value.user.uid, token: session.token, expiresAtEpochMs: session.expiresAtEpochMs };
      },
      decodeMe: (value: { user: { uid: string } }) => ({ userId: value.user.uid }),
      decodeSyncPage: (value: unknown) => value,
    },
    deviceId: 'device-recipient', runtime, clock: { nowEpochMs: () => now },
    async publishWidget(snapshot: unknown) { widgets.push(snapshot); },
    // Real Fastify handlers and SQLite behind injected network boundary; no external service.
    async fetch(url: string, init: RequestInit) {
      if (!online) throw new Error('Simulated lost connectivity');
      const parsed = new URL(url), headers = Object.fromEntries(new Headers(init.headers).entries());
      if (parsed.pathname === '/v1/sync') parsed.searchParams.set('projection', 'alarms');
      const response = await app.inject({ method: init.method as HTTPMethods, url: parsed.pathname + parsed.search,
        headers, ...(init.body === undefined ? {} : { payload: init.body as string }) });
      if (parsed.pathname.endsWith('/reportSchedule')) {
        reportRequests++;
        if (loseFirstAckResponse && response.statusCode === 200) {
          loseFirstAckResponse = false;
          throw new Error('Simulated lost HTTP response after server commit');
        }
      }
      return new Response(response.body, { status: response.statusCode, headers: { 'content-type': 'application/json' } });
    },
  });
  try {
    const sender = await registerUser(app, 'Sender');
    await client.register({ email: 'recipient@example.test', password: 'safe-password-123', displayName: 'Recipient' });
    const recipient = JSON.parse(secure.get('alarmat.session.v1')!);
    const group = { id: await createGroup(app, sender, 'Piso integración') };
    await inviteAndJoin(app, sender, group.id, { uid: recipient.userId, token: recipient.token, email: 'recipient@example.test', displayName: 'Recipient' });
    await call('POST', '/v1/devices', { deviceId: 'device-recipient', platform: 'android' }, recipient.token);
    const task = await call('POST', `/v1/groups/${group.id}/tasks`, { operationId: 'create-task', title: 'Sacar basura', assigneeUid: recipient.userId }, sender.token);
    const created = await call('POST', '/v1/operations/createAlarmRequest', { schemaVersion: 1, operationId: 'create-alarm', groupId: group.id,
      payload: { title: 'Sacar basura', taskId: task.id, recipientUids: [recipient.userId], mode: 'ALARM',
        timeSpec: createTimeSpec({ timeZone: 'Europe/Madrid', localDate: '2030-01-23', localTime: '20:00' }) } }, sender.token);
    const requestId = created.result.requestId, repository = client.getRepository()!;
    await repository.reconcile();
    assert.equal(repository.getSnapshot().alarms[0].decision, 'PENDING');
    assert.equal(runtime.calls.filter((call: string) => call === 'schedule').length, 0, 'receiving never grants consent');
    const accept = { schemaVersion: 1, operationId: 'accept-alarm', groupId: group.id, entityId: requestId,
      expectedRequestVersion: 1, expectedDecisionRevision: 1, payload: { decision: 'ACCEPTED', consentScope: 'THIS_OCCURRENCE' } };
    await repository.submit(accept);
    assert.equal(runtime.calls.filter((call: string) => call === 'schedule').length, 1);
    assert.equal(repository.getSnapshot().alarms[0].scheduling, 'SCHEDULED');
    assert.ok(repository.getSnapshot().operations.some((op: { lane: string; state: string }) => op.lane === 'ACK' && op.state === 'QUEUED'), 'lost ACK response remains durable');
    now += 60_000; // enough for retry backoff, within server's five-minute clock-skew guard
    await repository.reconcile();
    for (let retry = 0; retry < 5; retry++) await repository.submit(accept);
    assert.equal(runtime.calls.filter((call: string) => call === 'schedule').length, 1, 'retry never schedules another occurrence');
    assert.ok(reportRequests >= 2, 'ACK was retried over HTTP');
    assert.equal((remote.prepare('SELECT count(*) AS n FROM device_schedules').get() as { n: number }).n, 1);
    assert.ok(repository.getSnapshot().operations.filter((op: { lane: string }) => op.lane === 'ACK').every((op: { state: string }) => op.state === 'CONFIRMED'));
    remote.prepare('UPDATE alarm_projection_cursors SET expires_at_epoch_ms=? WHERE user_id=?').run(Date.now()-1, recipient.userId);
    await repository.reconcile();
    assert.equal(runtime.calls.filter((call: string) => call === 'schedule').length, 1, 'expired cursor restarts without rearming');
    remote.prepare('DELETE FROM alarm_projection_cursors WHERE user_id=?').run(recipient.userId);
    await repository.reconcile();
    assert.equal(runtime.calls.filter((call: string) => call === 'schedule').length, 1, 'pruned cursor restarts without rearming');
    assert.equal(repository.getSnapshot().alarms[0].scheduling, 'SCHEDULED');
    assert.ok(repository.getSnapshot().operations.filter((op: { lane: string }) => op.lane === 'ACK').every((op: { state: string }) => op.state === 'CONFIRMED'), 'cursor reset preserves confirmed outbox');
    const sent = await call('GET', `/v1/groups/${group.id}/alarms`, undefined, sender.token);
    assert.equal(sent.alarms[0].recipient.decision, 'ACCEPTED');
    assert.equal(sent.alarms[0].schedules[0].status, 'SCHEDULED', 'sender only sees programming after server ACK');
    assert.equal(sent.alarms[0].recipient.uid, recipient.userId);
    await call('POST', `/v1/groups/${group.id}/tasks/${task.id}`, { operationId: 'complete-task', status: 'completed', expectedVersion: 1 }, sender.token);
    online = false;
    await assert.rejects(repository.reconcile());
    assert.equal(runtime.scheduled[0]?.status, 'SCHEDULED', 'remote withdrawal cannot reach an offline phone');
    const waiting = await call('GET', `/v1/groups/${group.id}/alarms`, undefined, sender.token);
    assert.equal(waiting.alarms[0].request.status, 'WITHDRAWN');
    assert.equal(waiting.alarms[0].schedules[0].status, 'CANCEL_PENDING');
    online = true;
    await repository.reconcile();
    assert.equal(runtime.scheduled[0]?.status, 'CANCELLED');
    const withdrawn = await call('GET', `/v1/groups/${group.id}/alarms`, undefined, sender.token);
    assert.equal(withdrawn.alarms[0].schedules[0].status, 'CANCELLED');
    const logout = await client.logout();
    assert.equal(logout.remoteRevoked, true);
    assert.equal(secure.size, 0);
    assert.equal(widgets.at(-1), null);
    assert.equal(client.getRepository(), null);
    assert.equal((local.prepare('SELECT count(*) AS n FROM projections').get() as { n: number }).n, 0);
  } finally {
    local.close(); await fixture.close();
  }
});
