import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SessionManager, type SecureStorage } from '../../../src/data/remote/session.ts';
import { HttpClient, type FetchPort } from '../../../src/data/remote/http.ts';
import { HttpAlarmGateway, HttpAuthClient, validateAlarmRecord, validateSyncPage, type HttpWireCodec } from '../../../src/data/remote/gateway.ts';
import type { AlarmRecord, SyncPage } from '../../../src/data/model.ts';
import type { AuthSession } from '../../../src/data/remote/session.ts';
import type { RespondToAlarm } from '../../../src/domain/contracts/types.ts';

const fixture = (path: string): unknown => JSON.parse(readFileSync(`contracts/fixtures/${path}`, 'utf8'));
const credentials = { userId: 'ana', token: 'opaque-secret', expiresAtEpochMs: 10_000 };
const clock = { nowEpochMs: () => 1_000 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function storage(): SecureStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItemAsync: async key => data.get(key) ?? null,
    setItemAsync: async (key, value) => { data.set(key, value); }, deleteItemAsync: async key => { data.delete(key); } };
}
const codec: HttpWireCodec = {
  // Explicit test-only codec; production must get the agreed wrappers from P1/P3.
  decodeSession: body => body as AuthSession,
  decodeMe: body => body as { userId: string },
  decodeSyncPage: body => body as SyncPage,
};
function setup(fetch: FetchPort, options: { timeoutMs?: number; maxResponseBytes?: number } = {}) {
  const secure = storage();
  const sessions = new SessionManager(secure, clock);
  const http = new HttpClient({ baseUrl: 'https://api.example.test', sessions, fetch, ...options });
  return { secure, sessions, http, gateway: new HttpAlarmGateway(http, sessions, codec), auth: new HttpAuthClient(http, sessions, codec) };
}
function record(): AlarmRecord {
  return { groupId: 'group', requestId: 'request',
    request: fixture('documents/alarm-request.active.json') as AlarmRecord['request'],
    recipient: fixture('documents/recipient.accepted.json') as AlarmRecord['recipient'],
    primaryDevice: { deviceId: 'device', deviceEpoch: 1 }, schedules: [] };
}

test('session persists securely, observers hide token, restart restores and expiry rejects', async () => {
  const secure = storage(); let now = 1_000;
  const sessions = new SessionManager(secure, { nowEpochMs: () => now });
  await sessions.install(credentials);
  assert.equal(JSON.stringify(sessions.view()).includes(credentials.token), false);
  const restored = new SessionManager(secure, { nowEpochMs: () => now });
  await restored.restore(); assert.equal(restored.lease().token, credentials.token);
  now = 11_000;
  assert.throws(() => restored.lease(), { code: 'UNAUTHENTICATED' });
  await restored.restore(); assert.equal(restored.view()?.authenticated, false); assert.equal(secure.data.size, 0);
});

test('clear during SecureStore install rejects stale login and deletes the stored secret', async () => {
  const secure = storage(); const blocked = deferred<void>(); const entered = deferred<void>();
  const original = secure.setItemAsync;
  secure.setItemAsync = async (key, value) => { entered.resolve(); await blocked.promise; await original(key, value); };
  const sessions = new SessionManager(secure, clock);
  const installing = sessions.install(credentials);
  const rejected = assert.rejects(installing, { code: 'UNAUTHENTICATED' });
  await entered.promise;
  const clearing = sessions.clear(); blocked.resolve();
  await Promise.all([rejected, clearing]);
  assert.equal(sessions.view(), null); assert.equal(secure.data.size, 0);
});

test('restore cannot replace a newly installed account or erase a new token', async () => {
  const secure = storage(); const blocked = deferred<string | null>();
  secure.getItemAsync = () => blocked.promise;
  const sessions = new SessionManager(secure, clock);
  const restoring = sessions.restore(); await Promise.resolve();
  const installing = sessions.install(credentials);
  blocked.resolve(JSON.stringify({ ...credentials, userId: 'previous' }));
  await Promise.all([restoring, installing]);
  assert.equal(sessions.lease().userId, 'ana');
});

test('in-flight account reservation blocks concurrent login into another account', async () => {
  const secure = storage(); const blocked = deferred<void>();
  secure.setItemAsync = () => blocked.promise;
  const sessions = new SessionManager(secure, clock);
  const installing = sessions.install(credentials);
  await assert.rejects(sessions.install({ ...credentials, userId: 'bob' }), { code: 'FORBIDDEN' });
  blocked.resolve(); await installing;
});

test('HTTPS only; bearer and no-redirect policy; auth wrappers explicitly injected', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const ctx = setup(async (url, init) => { requests.push({ url, init }); return Response.json(url.endsWith('/login') ? credentials : { userId: 'ana' }); });
  assert.throws(() => new HttpClient({ baseUrl: 'http://localhost', sessions: ctx.sessions }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => new HttpClient({ baseUrl: 'https://user:secret@api.example.test', sessions: ctx.sessions }), { code: 'INVALID_ARGUMENT' });
  await ctx.auth.login({ example: 'test-only' });
  await ctx.auth.me();
  assert.equal((requests[0]?.init.headers as Record<string, string>).Authorization, undefined);
  assert.equal((requests[1]?.init.headers as Record<string, string>).Authorization, 'Bearer opaque-secret');
  assert.equal(requests[1]?.init.redirect, 'error');
});

test('late login and authenticated responses are rejected after clear even if fetch ignores abort', async () => {
  const login = deferred<Response>(); const ctx = setup(() => login.promise);
  const loggingIn = assert.rejects(ctx.auth.login({}), { code: 'UNAUTHENTICATED' });
  await ctx.sessions.clear(); login.resolve(Response.json(credentials)); await loggingIn;
  assert.equal(ctx.sessions.view(), null);
  const pending = deferred<Response>(); const other = setup(() => pending.promise);
  await other.sessions.install(credentials);
  const reading = assert.rejects(other.auth.me(), { code: 'UNAUTHENTICATED' });
  await other.sessions.clear(); pending.resolve(Response.json({ userId: 'ana' })); await reading;
});

test('401 invalidates only the matching session and keeps owner for pending local work', async () => {
  const ctx = setup(async () => new Response('private-secret', { status: 401 }));
  await ctx.sessions.install(credentials);
  await assert.rejects(ctx.auth.me(), { code: 'UNAUTHENTICATED' });
  assert.deepEqual(ctx.sessions.view(), { userId: 'ana', authenticated: false, expiresAtEpochMs: 0 });
  const leaseContext = setup(async () => Response.json({}));
  await leaseContext.sessions.install(credentials); const old = leaseContext.sessions.lease();
  await leaseContext.sessions.install({ ...credentials, token: 'new-secret' });
  await leaseContext.sessions.invalidate(old);
  assert.equal(leaseContext.sessions.lease().token, 'new-secret');
});

test('safe HTTP error codes do not expose server bodies or fetch error secrets', async () => {
  for (const [status, code] of [[403, 'FORBIDDEN'], [409, 'VERSION_CONFLICT'], [429, 'RATE_LIMITED'], [500, 'TEMPORARY_UNAVAILABLE']] as const) {
    const ctx = setup(async () => Response.json({ code, message: 'private-secret', details: { token: 'secret' } }, { status }));
    await ctx.sessions.install(credentials);
    await assert.rejects(ctx.auth.me(), (error: unknown) => {
      const e = error as { code: string; message: string; details?: unknown };
      assert.equal(e.code, code); assert.equal(e.message.includes('secret'), false); assert.equal(e.details, undefined); return true;
    });
  }
  const ctx = setup(async () => { throw new Error('private-secret'); });
  await ctx.sessions.install(credentials);
  await assert.rejects(ctx.auth.me(), (error: unknown) => !(error as Error).message.includes('private-secret'));
});

test('timeout, oversized streaming bodies, malformed JSON, redirects and wrong me identity fail closed', async () => {
  const cases: { fetch: FetchPort; code: string; timeoutMs?: number; maxResponseBytes?: number }[] = [
    { fetch: () => new Promise(() => undefined), code: 'TEMPORARY_UNAVAILABLE', timeoutMs: 5 },
    { fetch: async () => new Response('x'.repeat(100)), code: 'INVALID_ARGUMENT', maxResponseBytes: 32 },
    { fetch: async () => new Response('{bad'), code: 'INVALID_ARGUMENT' },
    { fetch: async () => new Response('', { status: 302 }), code: 'INVALID_ARGUMENT' },
    { fetch: async () => Response.json({ userId: 'bob' }), code: 'INVALID_ARGUMENT' },
  ];
  for (const c of cases) {
    const ctx = setup(c.fetch, c); await ctx.sessions.install(credentials);
    await assert.rejects(ctx.auth.me(), { code: c.code });
  }
});

test('gateway retries exactly the persisted command after lost commit response and checks receipt identity', async () => {
  const bodies: unknown[] = []; let attempt = 0;
  const command = fixture('operations/respond-to-alarm.accept.json') as RespondToAlarm;
  const ctx = setup(async (url, init) => {
    assert.equal(url, 'https://api.example.test/v1/operations/respondToAlarm'); bodies.push(init.body);
    if (++attempt === 1) throw new Error('response lost after commit');
    return Response.json({ operationId: command.operationId, status: 'REPLAYED', serverTimeEpochMs: 1_000 });
  });
  await ctx.sessions.install(credentials);
  await assert.rejects(ctx.gateway.execute('respondToAlarm', command), { code: 'TEMPORARY_UNAVAILABLE' });
  assert.equal((await ctx.gateway.execute('respondToAlarm', command)).status, 'REPLAYED');
  assert.equal(bodies[0], bodies[1]);
  const wrong = setup(async () => Response.json({ operationId: 'different', status: 'APPLIED', serverTimeEpochMs: 1_000 }));
  await wrong.sessions.install(credentials);
  await assert.rejects(wrong.gateway.execute('respondToAlarm', command), { code: 'INVALID_ARGUMENT' });
});

test('sync preserves opaque cursor and rejects foreign projections, nonadvancing pages and broken fields', async () => {
  const page: SyncPage = { events: [{ eventId: 'event', kind: 'upsert', alarm: record() }], nextCursor: 'next', hasMore: false, serverTimeEpochMs: 1_000 };
  const ctx = setup(async url => { assert.equal(url, "https://api.example.test/v1/sync?cursor=opaque%2B%3D%2F!'"); return Response.json(page); });
  await ctx.sessions.install(credentials);
  assert.equal((await ctx.gateway.sync("opaque+=/!'")).events.length, 1);
  assert.throws(() => validateSyncPage({ ...page, nextCursor: 'old', hasMore: true }, 'ana', 'old'), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => validateSyncPage({ ...page, events: Array(201).fill(page.events[0]) }, 'ana', null), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => validateAlarmRecord(record(), 'unrelated'), { code: 'INVALID_ARGUMENT' });
  const missingConsent = record(); delete missingConsent.recipient.consentScope;
  assert.throws(() => validateAlarmRecord(missingConsent, 'ana'), { code: 'INVALID_ARGUMENT' });
  const badEpoch = record(); badEpoch.primaryDevice!.deviceEpoch = 0;
  assert.throws(() => validateAlarmRecord(badEpoch, 'ana'), { code: 'INVALID_ARGUMENT' });
  const wrongMode = record(); wrongMode.schedules = [fixture('documents/schedule.scheduled.json') as AlarmRecord['schedules'][number]];
  assert.throws(() => validateAlarmRecord(wrongMode, 'ana'), { code: 'INVALID_ARGUMENT' });
});

test('remote logout leaves session cleanup under the coordinating service', async () => {
  const ctx = setup(async url => { assert.equal(url.endsWith('/v1/auth/logout'), true); return new Response(null, { status: 204 }); });
  await ctx.sessions.install(credentials); await ctx.auth.logoutRemote();
  assert.equal(ctx.sessions.view()?.userId, 'ana');
});

test('preserves allowed domain subcodes and only exposes bounded Retry-After metadata', async () => {
  for (const [status, code] of [[403, 'DEVICE_NOT_PRIMARY'], [409, 'EXPIRED']] as const) {
    const ctx = setup(async () => Response.json({ code, message: 'secret', details: { token: 'private' } }, { status }));
    await ctx.sessions.install(credentials);
    await assert.rejects(ctx.auth.me(), { code, details: undefined });
  }
  for (const [header, expected] of [['12', 12_000], ['99999999', 3_600_000], ['not-a-date', undefined]] as const) {
    const ctx = setup(async () => Response.json({ code: 'RATE_LIMITED', message: 'secret', details: { retryAfterMs: -1, token: 'private' } },
      { status: 429, headers: { 'Retry-After': header } }));
    await ctx.sessions.install(credentials);
    await assert.rejects(ctx.auth.me(), (error: unknown) => {
      const value = error as { code: string; details: unknown };
      assert.equal(value.code, 'RATE_LIMITED');
      assert.deepEqual(value.details, expected === undefined ? undefined : { retryAfterMs: expected });
      return true;
    });
  }
  const sessions = new SessionManager(storage(), clock); await sessions.install(credentials);
  const http = new HttpClient({ baseUrl: 'https://api.example.test', sessions, nowEpochMs: () => 0,
    fetch: async () => new Response('', { status: 503, headers: { 'Retry-After': 'Thu, 01 Jan 1970 00:00:30 GMT' } }) });
  await assert.rejects(http.authenticatedJson('/v1/sync', 'GET'), { code: 'TEMPORARY_UNAVAILABLE', details: { retryAfterMs: 30_000 } });
});

test('reverse proxy base path survives anonymous login and authenticated API calls', async () => {
  for (const baseUrl of ['https://app.example.test/alarmat/api', 'https://app.example.test/alarmat/api/']) {
    const requests: { url: string; init: RequestInit }[] = [];
    const sessions = new SessionManager(storage(), clock);
    const http = new HttpClient({ baseUrl, sessions, fetch: async (url, init) => {
      requests.push({ url, init });
      return Response.json(url.endsWith('/login') ? credentials : { userId: 'ana' });
    } });
    const auth = new HttpAuthClient(http, sessions, codec);
    await auth.login({ example: 'test-only' });
    await auth.me();
    await http.authenticatedJson('/v1/sync?cursor=opaque%2Ftoken', 'GET');
    assert.deepEqual(requests.map(request => request.url), [
      'https://app.example.test/alarmat/api/v1/auth/login',
      'https://app.example.test/alarmat/api/v1/auth/me',
      'https://app.example.test/alarmat/api/v1/sync?cursor=opaque%2Ftoken',
    ]);
    assert.equal((requests[0]!.init.headers as Record<string, string>).Authorization, undefined);
    assert.equal((requests[1]!.init.headers as Record<string, string>).Authorization, 'Bearer opaque-secret');
    for (const path of ['/v1/../../outside', '/v1/./auth/me', '//another.example/v1/auth/me']) {
      await assert.rejects(http.authenticatedJson(path, 'GET'), { code: 'INVALID_ARGUMENT' });
    }
    assert.equal(requests.length, 3);
  }
});

test('HTTPS transport preserves a configured application prefix without leaking auth to another origin', async () => {
  const ctx = setup(async () => Response.json({}));
  await ctx.sessions.install({ userId: 'alice', token: 'opaque-private-token', expiresAtEpochMs: 100_000 });
  let requested = '';
  const http = new HttpClient({ baseUrl: 'https://api.example.test/alarmat/api/', sessions: ctx.sessions,
    fetch: async (url, init) => { requested = url; assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer opaque-private-token'); return Response.json({ connected: true }); } });
  await http.authenticatedJson('/v1/calendar/google/status', 'GET');
  assert.equal(requested, 'https://api.example.test/alarmat/api/v1/calendar/google/status');
  await assert.rejects(() => http.authenticatedJson('//other.example/v1/calendar/google/status', 'GET'));
});

test('AI failures use safe actionable local messages and do not automatically retry', async () => {
 for(const path of ['/v1/agent/draft','/v1/agent/propose','/v1/ai/connection/test','/v1/ai/connection/save']) {
  let requests=0;const ctx=setup(async()=>{requests++;return Response.json({code:'TEMPORARY_UNAVAILABLE',message:'sk-private-provider-key'}, {status:503});});await ctx.sessions.install(credentials);
  await assert.rejects(ctx.http.authenticatedJson(path,'POST',{}),(e:unknown)=>{assert.match((e as Error).message,/Revisa tu conexión o crea la alarma manualmente/);assert.ok(!(e as Error).message.includes('private'));return true;});assert.equal(requests,1);
 }
 const ctx=setup(()=>new Promise(()=>undefined),{timeoutMs:5});await ctx.sessions.install(credentials);
 await assert.rejects(ctx.http.authenticatedJson('/v1/agent/draft','POST',{}),/Revisa tu conexión/);
});

test('AI transport permits the server call budget while ordinary requests keep their shorter timeout',async(t)=>{
 const delays:number[]=[];const original=globalThis.setTimeout;
 t.mock.method(globalThis,'setTimeout',((callback:()=>void,delay?:number,...args:unknown[])=>{delays.push(delay??0);return original(callback,delay);}) as typeof setTimeout);
 const ctx=setup(async()=>Response.json({ok:true}));await ctx.sessions.install(credentials);
 await ctx.http.authenticatedJson('/v1/agent/draft','POST',{});
 await ctx.http.authenticatedJson('/v1/ai/connection/test','POST',{});
 await ctx.http.authenticatedJson('/v1/groups','GET');
 assert.deepEqual(delays,[65_000,65_000,15_000]);
});
