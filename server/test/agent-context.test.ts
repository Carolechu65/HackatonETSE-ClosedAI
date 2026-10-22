import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimeSpec, wallClockInZone } from '../../src/domain/time.ts';
import { DeterministicAgentProvider } from '../src/agents/deterministic.ts';
import { OpenAiCompatibleProvider } from '../src/agents/openai.ts';
import type { AgentContext, AgentDraft, AgentProvider } from '../src/agents/types.ts';
import { createTask } from '../src/tasks/service.ts';
import { auth, createAlarm, createGroup, FUTURE_TIME, inviteAndJoin, operationId, registerUser, setupTest } from './helpers.ts';

function context(nowEpochMs: number, text: string): AgentContext {
  return { actorUid: 'self', groupId: 'home', nowEpochMs, timeZone: 'Europe/Madrid',
    currentLocal: { ...wallClockInZone(nowEpochMs, 'Europe/Madrid'), timeZone: 'Europe/Madrid', weekday: 'jueves' },
    members: [{ uid: 'self', displayName: 'Luis', role: 'OWNER' }], tasks: [], alarms: [], conversation: [text],
    contextLimits: { tasks: 20, alarms: 20, tasksTruncated: false, alarmsTruncated: false, alarmVisibility: 'SENT_OR_RECEIVED' } };
}

test('relative ten-minute requests use the current clock, midnight and the household timezone', async () => {
  const provider = new DeterministicAgentProvider();
  for (const now of [Date.UTC(2026, 9, 22, 15, 0), Date.UTC(2026, 9, 22, 21, 55)]) {
    const draft = await provider.next(context(now, 'Ponme una alarma dentro de 10 minutos')) as AgentDraft;
    assert.equal(draft.type, 'draft');
    assert.deepEqual(draft.recipientUids, ['self']);
    assert.equal(draft.timeSpec.effectiveAtEpochMs, now + 10 * 60000);
    assert.deepEqual({ localDate: draft.timeSpec.localDate, localTime: draft.timeSpec.localTime }, wallClockInZone(now + 10 * 60000, 'Europe/Madrid'));
  }
  const seconds = Date.UTC(2026, 9, 22, 15, 0, 30);
  const rounded = await provider.next(context(seconds, 'Ponme una alarma dentro de 10min')) as AgentDraft;
  assert.equal(rounded.timeSpec.effectiveAtEpochMs, Date.UTC(2026, 9, 22, 15, 11));
});

test('tomorrow uses the next civil date across the autumn daylight saving transition', async () => {
  const now = Date.UTC(2026, 9, 24, 22, 30); // 25 Oct 00:30 in Madrid; tomorrow is 26 Oct.
  const draft = await new DeterministicAgentProvider().next(context(now, 'ponerme una alarma para mañana a las22h')) as AgentDraft;
  assert.equal(draft.type, 'draft');
  assert.equal(draft.timeSpec.localDate, '2026-10-26');
  assert.equal(draft.timeSpec.localTime, '22:00');
  assert.equal(draft.title, 'una alarma');
});

test('relative requests crossing a repeated wall time ask instead of silently choosing the wrong occurrence', async () => {
  const result = await new DeterministicAgentProvider().next(context(Date.UTC(2026, 9, 25, 0, 55), 'Ponme una alarma dentro de 10 minutos')) as { type: string };
  assert.equal(result.type, 'clarification');
});

test('context contains local now, shared tasks with pending first and only permitted sent/received alarms and recipient responses', async () => {
  const seen: AgentContext[] = [];
  const provider: AgentProvider = { label: 'context-inspector', async next(input) { seen.push(input); return { type: 'clarification', question: '¿Qué quieres recordar?', missingFields: ['title'] }; } };
  const ctx = await setupTest({ agentProvider: provider });
  try {
    const owner = await registerUser(ctx.app, 'Luis'), ana = await registerUser(ctx.app, 'Ana'), third = await registerUser(ctx.app, 'Carla');
    const groupId = await createGroup(ctx.app, owner);
    await inviteAndJoin(ctx.app, owner, groupId, ana); await inviteAndJoin(ctx.app, owner, groupId, third);
    const sent = await createAlarm(ctx.app, owner, groupId, [ana.uid]);
    const received = await createAlarm(ctx.app, ana, groupId, [owner.uid, third.uid]);
    const privateAlarm = await createAlarm(ctx.app, ana, groupId, [third.uid]);
    const otherGroup = await createGroup(ctx.app, owner, 'Otra casa');
    const otherAlarm = await createAlarm(ctx.app, owner, otherGroup, [owner.uid]);
    const chosen = createTimeSpec({ ...FUTURE_TIME, localTime: '22:00' });
    ctx.db.prepare("UPDATE alarm_recipients SET decision='ACCEPTED',accepted_request_version=1,chosen_time_zone=?,chosen_local_date=?,chosen_local_time=?,chosen_effective_at_epoch_ms=? WHERE request_id=? AND uid=?")
      .run(chosen.timeZone, chosen.localDate, chosen.localTime, chosen.effectiveAtEpochMs, sent, ana.uid);
    const task = createTask(ctx.db, owner.uid, groupId, { operationId: operationId(), title: 'Sacar la basura', assigneeUid: ana.uid, dueAtEpochMs: FUTURE_TIME.effectiveAtEpochMs });
    const completed = createTask(ctx.db, owner.uid, groupId, { operationId: operationId(), title: 'Ya terminada' });
    ctx.db.prepare("UPDATE tasks SET status='COMPLETED' WHERE id=?").run(completed.id);
    createTask(ctx.db, owner.uid, otherGroup, { operationId: operationId(), title: 'Tarea de otro piso' });
    const response = await ctx.app.inject({ method: 'POST', url: '/v1/agent/propose', headers: auth(owner.token), payload: { groupId, text: 'Ayúdame con mis avisos' } });
    assert.equal(response.statusCode, 200, response.body);
    const input = seen[0]!;
    assert.equal(input.actorUid, owner.uid);
    assert.deepEqual(input.currentLocal, { ...wallClockInZone(input.nowEpochMs, 'Europe/Madrid'), timeZone: 'Europe/Madrid', weekday: new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long' }).format(input.nowEpochMs) });
    assert.deepEqual(input.alarms.map(alarm => alarm.id).sort(), [sent, received].sort());
    assert.ok(!input.alarms.some(alarm => [privateAlarm, otherAlarm].includes(alarm.id)));
    assert.deepEqual(input.alarms.find(alarm => alarm.id === received)!.recipients.map(recipient => recipient.uid), [owner.uid]);
    const recipient = input.alarms.find(alarm => alarm.id === sent)!.recipients[0]!;
    assert.equal(recipient.displayName, 'Ana'); assert.equal(recipient.decision, 'ACCEPTED'); assert.deepEqual(recipient.chosenTimeSpec, chosen);
    assert.deepEqual(input.tasks.map(item => item.id), [task.id, completed.id]);
    assert.equal(input.tasks[1]!.status, 'COMPLETED');
    assert.equal(input.tasks[0]!.assignedTo, ana.uid);
    assert.equal(input.tasks[0]!.dueAtEpochMs, FUTURE_TIME.effectiveAtEpochMs);
    assert.equal(input.contextLimits.alarmsTruncated, false);
    assert.equal(input.contextLimits.tasksTruncated, false);
    for (let index = 0; index < 21; index++) {
      createTask(ctx.db, owner.uid, groupId, { operationId: operationId(), title: `Pendiente ${index}` });
      await createAlarm(ctx.app, owner, groupId, [owner.uid]);
    }
    await ctx.app.inject({ method: 'POST', url: '/v1/agent/propose', headers: auth(owner.token), payload: { groupId, text: 'Ayúdame con mis avisos' } });
    assert.equal(seen[1]!.tasks.length, 20); assert.equal(seen[1]!.alarms.length, 20);
    assert.equal(seen[1]!.contextLimits.tasksTruncated, true); assert.equal(seen[1]!.contextLimits.alarmsTruncated, true);
  } finally { await ctx.close(); }
});

test('draft task links survive validation and normalized route, while closed, missing and foreign tasks are rejected', async () => {
  let taskId = '';
  const provider: AgentProvider = { label: 'task-link-test', async next(input) { return { type: 'draft', title: 'Tarea pendiente', recipientUids: [input.actorUid], timeSpec: FUTURE_TIME, mode: 'NOTIFICATION', reason: 'Aviso de tarea', taskId }; } };
  const ctx = await setupTest({ agentProvider: provider });
  try {
    const owner = await registerUser(ctx.app, 'Luis'); const groupId = await createGroup(ctx.app, owner);
    const task = createTask(ctx.db, owner.uid, groupId, { operationId: operationId(), title: 'Sacar la basura' });
    const otherGroup = await createGroup(ctx.app, owner, 'Otro piso');
    const foreign = createTask(ctx.db, owner.uid, otherGroup, { operationId: operationId(), title: 'Privada' });
    const call = (url: string) => ctx.app.inject({ method: 'POST', url, headers: auth(owner.token), payload: { groupId, text: 'Recuérdame la tarea mañana a las 21:00' } });
    taskId = task.id;
    for (const route of ['/v1/agent/propose', '/v1/agent/draft']) {
      const valid = await call(route); assert.equal(valid.statusCode, 200, valid.body); assert.equal(valid.json().draft.taskId, task.id);
    }
    for (const invalid of [foreign.id, 'task-missing']) { taskId = invalid; const result = await call('/v1/agent/propose'); assert.equal(result.statusCode, 503, result.body); }
    ctx.db.prepare("UPDATE tasks SET status='COMPLETED' WHERE id=?").run(task.id);
    taskId = task.id; assert.equal((await call('/v1/agent/propose')).statusCode, 503);
    assert.equal((ctx.db.prepare('SELECT count(*) AS n FROM alarm_requests').get() as { n: number }).n, 0);
  } finally { await ctx.close(); }
});

test('OpenAI transport sends explicit clock and bounded authorized context, preserves task link and resolves epoch itself', async t => {
  const input = context(Date.UTC(2026, 9, 22, 15, 0), 'Recuérdame sacar la basura dentro de 10 minutos');
  input.tasks = [{ id: 'task-1', title: 'Sacar la basura', assignedTo: 'self', status: 'PENDING', dueAtEpochMs: null }];
  let outbound: { messages: Array<{ content: string }> } | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    outbound = JSON.parse(options.body as string);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ type: 'draft', title: 'Sacar la basura', recipientUids: ['self'], timeSpec: { localDate: '2026-10-22', localTime: '17:10', timeZone: 'Europe/Madrid', effectiveAtEpochMs: 0 }, mode: 'ALARM', taskId: 'task-1', reason: 'Aviso propio' }) } }] }), { status: 200 });
  });
  const provider = new OpenAiCompatibleProvider({ baseUrl: 'https://provider.invalid', apiKey: 'synthetic-test-key', model: 'test-model', timeoutMs: 1000 });
  const draft = await provider.next(input) as AgentDraft;
  assert.equal(draft.taskId, 'task-1');
  assert.equal(draft.timeSpec.effectiveAtEpochMs, input.nowEpochMs + 10 * 60000);
  const sent = JSON.parse(outbound!.messages[1]!.content);
  assert.deepEqual(sent.currentLocal, input.currentLocal); assert.deepEqual(sent.tasks, input.tasks); assert.deepEqual(sent.alarms, []); assert.deepEqual(sent.contextLimits, input.contextLimits);
  assert.match(outbound!.messages[0]!.content, /dentro de 10 minutos/);
});
