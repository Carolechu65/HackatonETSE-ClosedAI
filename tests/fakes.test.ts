import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createFakeAlarmRuntime,
  createFakeClock,
  createInMemoryAlarmRepository,
  type AlarmSummary,
  type RespondToAlarm,
} from '../src/domain/index.ts';

const item: AlarmSummary = {
  id: 'req-001',
  title: 'Sacar la basura',
  proposedBy: 'Luis',
  scheduledAt: '2026-10-23T19:00:00.000Z',
  decision: 'pending',
  scheduling: 'not_scheduled',
};

function respond(decision: 'ACCEPTED' | 'REJECTED' | 'DISABLED'): RespondToAlarm {
  return {
    schemaVersion: 1,
    operationId: `op-${decision.toLowerCase()}`,
    groupId: 'piso-demo',
    entityId: 'req-001',
    expectedRequestVersion: 1,
    expectedDecisionRevision: 1,
    payload: decision === 'ACCEPTED'
      ? { decision, consentScope: 'THIS_OCCURRENCE' }
      : { decision },
  };
}

test('aceptar deja activación pendiente, nunca programada', async () => {
  const repository = createInMemoryAlarmRepository({ items: [item] });
  let current: readonly AlarmSummary[] = [];
  repository.subscribeInbox((items) => {
    current = items;
  });

  const receipt = await repository.submit(respond('ACCEPTED'));
  assert.equal(receipt.status, 'APPLIED');
  assert.equal(current[0]?.decision, 'accepted');
  assert.equal(current[0]?.scheduling, 'pending_activation');
});

test('rechazar no programa nada', async () => {
  const repository = createInMemoryAlarmRepository({ items: [item] });
  await repository.submit(respond('REJECTED'));
  const listed = await new Promise<readonly AlarmSummary[]>((resolve) => {
    repository.subscribeInbox((items) => resolve(items));
  });
  assert.equal(listed[0]?.decision, 'rejected');
  assert.equal(listed[0]?.scheduling, 'not_scheduled');
});

test('un fallo de red se representa como error, no como éxito', async () => {
  const repository = createInMemoryAlarmRepository({ items: [item] });
  repository.failNext();
  await assert.rejects(() => repository.submit(respond('ACCEPTED')), /conexión/i);
});

test('el runtime falso distingue permiso pendiente de programación', async () => {
  const denied = createFakeAlarmRuntime({ permissionMissing: true });
  const spec = {
    userId: 'ana',
    requestId: 'req-001',
    occurrenceId: 'occ-1792782000000',
    deviceId: 'dev-a1',
    deviceEpoch: 1,
    requestVersion: 1,
    decisionRevision: 1,
    effectiveAtEpochMs: 1792782000000,
    timeZone: 'Europe/Madrid',
    title: 'Sacar la basura',
    mode: 'ALARM' as const,
  };
  assert.equal((await denied.schedule(spec)).status, 'PENDING_PERMISSION');
  assert.equal((await denied.getSnapshot()).occurrences.length, 0);

  const allowed = createFakeAlarmRuntime();
  assert.equal((await allowed.schedule(spec)).status, 'SCHEDULED');
  assert.equal(allowed.scheduled.length, 1);
  assert.equal((await allowed.cancel(spec)).status, 'CANCELLED');
  assert.equal(allowed.scheduled[0]?.status, 'CANCELLED');
});

test('el runtime falso sin módulo nativo no finge programar', async () => {
  const runtime = createFakeAlarmRuntime({ available: false });
  const capabilities = await runtime.getCapabilities();
  assert.equal(capabilities.available, false);
  const result = await runtime.schedule({
    userId: 'ana',
    requestId: 'req-001',
    occurrenceId: 'occ-1',
    deviceId: 'dev-a1',
    deviceEpoch: 1,
    requestVersion: 1,
    decisionRevision: 1,
    effectiveAtEpochMs: 1792782000000,
    timeZone: 'Europe/Madrid',
    title: 'x',
    mode: 'ALARM',
  });
  assert.equal(result.status, 'FAILED');
});

test('el reloj falso avanza de forma determinista', () => {
  const clock = createFakeClock(1000);
  clock.advance(500);
  assert.equal(clock.nowEpochMs(), 1500);
  clock.set(10);
  assert.equal(clock.nowEpochMs(), 10);
});
