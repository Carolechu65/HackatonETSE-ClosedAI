import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTest, registerUser, createGroup, inviteAndJoin, auth, operationId, createAlarmBody } from './helpers.ts';

test('task assignments require recipient approval, deduplicate, and disappear from authorized notices', async () => {
  const ctx = await setupTest();
  try {
    const a = await registerUser(ctx.app, 'Ana'), b = await registerUser(ctx.app, 'Bea'), c = await registerUser(ctx.app, 'Cris');
    const group = await createGroup(ctx.app, a); await inviteAndJoin(ctx.app, a, group, b);
    const call = (user: typeof a, url: string, payload?: Record<string, unknown>) => ctx.app.inject({ method: payload ? 'POST' : 'GET', url, headers: auth(user.token), ...(payload ? { payload } : {}) });
    const task = (await call(a, `/v1/groups/${group}/tasks`, { operationId: operationId(), title: 'Tender ropa', assigneeUid: b.uid })).json();
    assert.equal(task.assignmentDecision, 'pending');
    const notices = (await call(b, '/v1/assignments')).json().assignments;
    assert.equal(notices.length, 1); assert.equal(notices[0].kind, 'task'); assert.equal(notices[0].entityId, task.id);
    assert.equal((await call(c, '/v1/assignments')).json().assignments.length, 0);
    assert.equal((await call(b, `/v1/groups/${group}/tasks/${task.id}`, { operationId: operationId(), status: 'completed', expectedVersion: 1 })).statusCode, 403);
    const decision = { operationId: operationId(), decision: 'accepted', expectedVersion: 1 };
    const path = `/v1/groups/${group}/tasks/${task.id}/assignment`;
    assert.equal((await call(a, path, decision)).statusCode, 403);
    const accepted = await call(b, path, decision); assert.equal(accepted.statusCode, 200, accepted.body); assert.equal(accepted.json().version, 2);
    assert.deepEqual((await call(b, path, decision)).json(), accepted.json());
    assert.equal((await call(b, '/v1/assignments')).json().assignments.length, 0);
    assert.equal((await call(b, path, { ...decision, operationId: operationId(), decision: 'rejected' })).statusCode, 409);
    assert.equal((await call(b, `/v1/groups/${group}/tasks/${task.id}`, { operationId: operationId(), status: 'completed', expectedVersion: 2 })).statusCode, 200);
  } finally { await ctx.close(); }
});

test('alarm and notification proposals both notify only their recipient and retain explicit consent', async () => {
  const ctx = await setupTest();
  try {
    const a = await registerUser(ctx.app, 'Ana'), b = await registerUser(ctx.app, 'Bea');
    const group = await createGroup(ctx.app, a); await inviteAndJoin(ctx.app, a, group, b);
    for (const mode of ['ALARM', 'NOTIFICATION']) {
      const body = createAlarmBody({ groupId: group, recipientUids: [b.uid] }); (body.payload as any).mode = mode;
      const created = await ctx.app.inject({ method: 'POST', url: '/v1/operations/createAlarmRequest', headers: auth(a.token), payload: body });
      assert.equal(created.statusCode, 200, created.body);
    }
    const response = await ctx.app.inject({ url: '/v1/assignments', headers: auth(b.token) });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().assignments.length, 2);
    assert.ok(response.json().assignments.some((x: any) => x.body.includes('una notificación')));
    assert.equal((await ctx.app.inject({ url: '/v1/assignments', headers: auth(a.token) })).json().assignments.length, 0);
    assert.equal((await ctx.app.inject({ url: '/v1/assignments' })).statusCode, 401);
    assert.equal((ctx.db.prepare("SELECT count(*) AS n FROM alarm_recipients WHERE decision='PENDING'").get() as any).n, 2);
  } finally { await ctx.close(); }
});

test('creating an alarm with a task is atomic, replayable, and preserves existing linked tasks', async () => {
  const ctx = await setupTest();
  try {
    const a = await registerUser(ctx.app, 'Ana'); const group = await createGroup(ctx.app, a);
    const body = createAlarmBody({ groupId: group, recipientUids: [a.uid] });
    const create = (payload: Record<string, unknown>) => ctx.app.inject({ method: 'POST', url: '/v1/operations/createTaskAlarm', headers: auth(a.token), payload });
    const first = await create(body); assert.equal(first.statusCode, 200, first.body);
    const second = await create(body); assert.equal(second.statusCode, 200, second.body); assert.equal(second.json().result.requestId, first.json().result.requestId);
    const task = ctx.db.prepare('SELECT * FROM tasks').get() as any;
    const alarm = ctx.db.prepare('SELECT * FROM alarm_requests').get() as any;
    assert.equal(task.id, alarm.task_id); assert.equal(task.title, alarm.title); assert.equal(task.assignment_decision, 'not_required');
    const invalid = createAlarmBody({ groupId: group, recipientUids: ['missing-user'] });
    assert.equal((await create(invalid)).statusCode, 403);
    const badMode = createAlarmBody({ groupId: group, recipientUids: [a.uid] }); (badMode.payload as any).mode = 'INVALID';
    assert.equal((await create(badMode)).statusCode, 400);
    assert.equal((ctx.db.prepare('SELECT count(*) AS n FROM tasks').get() as any).n, 1);
  } finally { await ctx.close(); }
});
