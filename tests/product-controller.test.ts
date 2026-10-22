import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductController, decodeProductAlarms } from '../src/composition/controller.ts';
import { alarmStatus } from '../src/composition/product.ts';
import { demoProductState } from '../src/composition/demo.ts';
import type { ProductBackend } from '../src/composition/backend.ts';

const demo = () => createProductController(async () => { throw new Error('La demo no debe conectar.'); });
test('demo acceptance is idempotent and never claims native scheduling', async () => {
  const client = demo(); await client.startDemo(); const alarm = client.getSnapshot().alarms[0]!;
  const payload = { decision: 'ACCEPTED' as const, consentScope: 'THIS_OCCURRENCE' as const, chosenTimeSpec: alarm.request.timeSpec };
  await client.respond(alarm, payload, 'accept-once'); await client.respond(alarm, payload, 'accept-once');
  const updated = client.getSnapshot().alarms[0]!;
  assert.equal(updated.recipients[0]?.decisionRevision, 2);
  assert.equal(alarmStatus(updated, 'demo-ana').title, 'Aceptada · por activar');
  assert.deepEqual(updated.schedules, []);
});
test('demo logout clears all private data and a new demo resets decisions', async () => {
  const client = demo(); await client.startDemo(); const alarm = client.getSnapshot().alarms[0]!;
  await client.respond(alarm, { decision: 'REJECTED' }, 'reject-once'); await client.signOut();
  assert.equal(client.getSnapshot().session, null); assert.deepEqual(client.getSnapshot().alarms, []);
  await client.startDemo(); assert.equal(client.getSnapshot().alarms[0]?.recipients[0]?.decision, 'PENDING');
});
test('alarm decoder rejects another group and private recipient', () => {
  const alarm = demoProductState().alarms[0]!;
  const row = { ...alarm, recipient: alarm.recipients[0] };
  assert.throws(() => decodeProductAlarms({ alarms: [row] }, 'other-group', 'demo-ana'));
  assert.throws(() => decodeProductAlarms({ alarms: [row] }, alarm.groupId, 'intruder'));
  assert.equal(decodeProductAlarms({ alarms: [row] }, alarm.groupId, 'demo-ana').length, 1);
});
test('a late remote group response cannot replace the demo session', async () => {
  let release!: (value: unknown) => void;
  let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const api: ProductBackend = {
    initialize: async () => {}, authenticate: async () => {}, logout: async () => {}, userId: () => 'real-user',
    request: async () => { started(); return new Promise(resolve => { release = resolve; }); },
    reconcile: async () => {}, submit: async () => { throw new Error('unused'); }, decorate: alarms => alarms,
    pending: () => 0, subscribe: () => () => {}, makePrimaryDevice: async () => '', requestPermissions: async () => '',
  };
  const client = createProductController(async () => api);
  const refresh = client.refresh(); await waiting; await client.startDemo(); release({ groups: [] });
  await assert.rejects(refresh); assert.equal(client.getSnapshot().session?.mode, 'demo');
  assert.equal(client.getSnapshot().groupId, 'demo-casa');
});

test('switching to demo waits for and cleans a late login without replacing the demo', async () => {
  let userId: string | null = null; let release!: () => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const api: ProductBackend = {
    initialize: async () => {}, userId: () => userId,
    authenticate: async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); userId = 'real-user'; },
    logout: async () => { userId = null; }, request: async () => { throw new Error('stale login must not load groups'); },
    submit: async () => { throw new Error('unused'); }, reconcile: async () => {}, decorate: alarms => alarms,
    pending: () => 0, subscribe: () => () => {}, requestPermissions: async () => '', makePrimaryDevice: async () => '',
  };
  const client = createProductController(async () => api);
  const login = client.signIn({ email: 'test@example.test', password: 'unused' }, false);
  const rejected = assert.rejects(login); await started;
  const switchToDemo = client.startDemo(); release(); await rejected; await switchToDemo;
  assert.equal(client.getSnapshot().session?.mode, 'demo'); assert.equal(userId, null);
});

test('failed native cleanup keeps an explicit retry path and blocks another login', async () => {
  let failCleanup = true;
  const api: ProductBackend = {
    initialize: async () => {}, userId: () => 'real-user', authenticate: async () => {},
    logout: async () => { if (failCleanup) throw new Error('widget unavailable'); },
    request: async path => path === '/v1/groups' ? { groups: [] } : { user: { uid: 'real-user', displayName: 'Ana' } },
    submit: async () => { throw new Error('unused'); }, reconcile: async () => {}, decorate: alarms => alarms,
    pending: () => 0, subscribe: () => () => {}, requestPermissions: async () => '', makePrimaryDevice: async () => '',
  };
  const client = createProductController(async () => api);
  await client.signIn({ email: 'test@example.test', password: 'unused' }, false);
  await assert.rejects(client.signOut()); assert.equal(client.getSnapshot().cleanupPending, true);
  await assert.rejects(client.signIn({ email: 'other@example.test', password: 'unused' }, false));
  failCleanup = false; await client.signOut(); assert.equal(client.getSnapshot().cleanupPending, false);
  assert.equal(client.getSnapshot().session, null);
});

for (const feature of ['finance', 'calendar'] as const) {
 test(`${feature} cannot send a request after logout starts while awaiting backend`, async () => {
  const sent: string[] = [];
  const api: ProductBackend = {
   initialize: async () => {}, authenticate: async () => {}, logout: async () => {}, userId: () => 'real-user',
   request: async path => { sent.push(path); if(path === '/v1/groups') return {groups: []}; if(path === '/v1/auth/me') return {user: {uid:'real-user',displayName:'Ana'}}; throw new Error('Private request must be blocked before transport'); },
   reconcile: async () => {}, submit: async () => { throw new Error('unused'); }, decorate: alarms => alarms,
   pending: () => 0, subscribe: () => () => {}, makePrimaryDevice: async () => '', requestPermissions: async () => '',
  };
  const client = createProductController(async () => api);
  await client.signIn({email:'a@example.test',password:'unused'},false); sent.length=0;
  const request = feature === 'finance' ? client.finance.list('group-1') : client.calendar.status();
  const rejected = assert.rejects(request, /sesión o el piso ha cambiado/);
  await client.signOut(); await rejected;
  assert.deepEqual(sent, []);
 });
}

test('live task changes publish refreshed widget context; failed household switch clears selection first', async () => {
  let userId: string | null = 'ana';
  let tasks: import('../src/features/tasks/model.ts').HouseholdTask[] = [];
  let published: import('../src/composition/widgetProjection.ts').WidgetTaskContext | null = null;
  const selections: Array<string | null> = [];
  let failB = false;
  const api: ProductBackend = {
    initialize: async () => {}, authenticate: async () => {}, userId: () => userId,
    logout: async () => { userId = null; published = null; }, reconcile: async () => {},
    selectGroup: async id => { selections.push(id); }, updateWidgetTasks: async value => { published = value; },
    request: async (path, method, body) => {
      if (path === '/v1/groups') return { groups: ['a', 'b'].map(id => ({ id, name: id, timeZone: 'Europe/Madrid', role: 'member' })) };
      if (path === '/v1/auth/me') return { user: { displayName: 'Ana' } };
      if (path.includes('/b/') && failB) throw new Error('Sin red');
      if (path.endsWith('/members')) return { members: [{ userId: 'ana', displayName: 'Ana', role: 'member' }] };
      if (path.endsWith('/alarms')) return { alarms: [] };
      if (method === 'POST' && path.endsWith('/tasks')) {
        tasks = [{ ...(body as import('../src/features/tasks/model.ts').TaskDraft), id: 'nueva', groupId: 'a', createdByUid: 'ana', status: 'pending', version: 1, completedByUid: null, completedAtEpochMs: null }];
        return { id: 'nueva' };
      }
      if (method === 'POST' && path.endsWith('/tasks/nueva')) {
        tasks = tasks.map(task => ({ ...task, status: (body as { status: 'pending' | 'completed' }).status, version: task.version + 1 }));
        return {};
      }
      if (path.endsWith('/tasks')) return { tasks };
      throw new Error(`Unexpected ${path}`);
    },
    submit: async () => { throw new Error('unused'); }, decorate: alarms => alarms, pending: () => 0,
    subscribe: () => () => {}, makePrimaryDevice: async () => '', requestPermissions: async () => '',
  };
  const client = createProductController(async () => api);
  await client.signIn({ email: 'ana@example.test', password: 'unused' }, false);
  await client.createTask({ title: 'Comprar pan', assigneeUid: 'ana', activateAtEpochMs: null, dueAtEpochMs: null }, 'create');
  const getPublished = () => published as import('../src/composition/widgetProjection.ts').WidgetTaskContext | null;
  assert.equal(getPublished()?.tasks[0]?.title, 'Comprar pan');
  await client.updateTask(client.getSnapshot().tasks[0]!, 'completed', 'complete');
  assert.equal(getPublished()?.tasks[0]?.status, 'completed');
  await client.updateTask(client.getSnapshot().tasks[0]!, 'pending', 'reopen');
  assert.equal(getPublished()?.tasks[0]?.status, 'pending');
  failB = true;
  await assert.rejects(client.selectGroup('b'), /Sin red/);
  assert.equal(selections.at(-1), 'b');
  assert.deepEqual(client.getSnapshot().tasks, []);
  await client.signOut(); assert.equal(getPublished(), null);
});


test('demo task assignment accepts explicitly, rejects unauthorized responses and replays once', async () => {
  const client = demo(); await client.startDemo();
  const pending = client.getSnapshot().tasks.find(task => task.id === 'demo-asignacion')!;
  await assert.rejects(client.updateTask(pending, 'completed', 'before-accept'), /aceptar/);
  await client.respondTaskAssignment(pending, 'accepted', 'assignment-accept');
  await client.respondTaskAssignment(pending, 'accepted', 'assignment-accept');
  const accepted = client.getSnapshot().tasks.find(task => task.id === pending.id)!;
  assert.equal(accepted.assignmentDecision, 'accepted'); assert.equal(accepted.version, pending.version + 1);
  await client.updateTask(accepted, 'completed', 'after-accept');
  assert.equal(client.getSnapshot().tasks.find(task => task.id === pending.id)?.status, 'completed');
  const id = await client.createTask({ title: 'Asignada a Dani', assigneeUid: 'demo-dani', activateAtEpochMs: null, dueAtEpochMs: null }, 'assign-dani');
  const other = client.getSnapshot().tasks.find(task => task.id === id)!;
  assert.equal(other.assignmentDecision, 'pending');
  await assert.rejects(client.respondTaskAssignment(other, 'accepted', 'impersonate'), /Solo la persona/);
});

test('demo task rejection preserves pending work while blocking completion', async () => {
  const client = demo(); await client.startDemo();
  const pending = client.getSnapshot().tasks.find(task => task.id === 'demo-asignacion')!;
  await client.respondTaskAssignment(pending, 'rejected', 'assignment-reject');
  const rejected = client.getSnapshot().tasks.find(task => task.id === pending.id)!;
  assert.equal(rejected.assignmentDecision, 'rejected'); assert.equal(rejected.status, 'pending');
  await assert.rejects(client.updateTask(rejected, 'completed', 'complete-rejected'), /rechazada/);
});
