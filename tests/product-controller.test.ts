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
