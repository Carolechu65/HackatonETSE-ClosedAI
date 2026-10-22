import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createDeterministicIdGenerator,
  createIdGenerator,
  OCCURRENCE_ID_PREFIX,
  occurrenceIdFromEpochMs,
  occurrenceKey,
} from '../src/domain/index.ts';
import { expectDomainError } from './helpers.ts';

const identity = {
  userId: 'ana',
  requestId: 'req-001',
  occurrenceId: 'occ-1792782000000',
  deviceId: 'dev-a1',
  deviceEpoch: 1,
};

test('el identificador de ocurrencia es estable entre reintentos', () => {
  assert.equal(occurrenceIdFromEpochMs(1792782000000), `${OCCURRENCE_ID_PREFIX}1792782000000`);
  assert.equal(occurrenceIdFromEpochMs(1792782000000), occurrenceIdFromEpochMs(1792782000000));
  expectDomainError(() => occurrenceIdFromEpochMs(-1), 'INVALID_ARGUMENT');
});

test('la clave de ocurrencia distingue dispositivo y epoch', () => {
  assert.equal(occurrenceKey(identity), 'ana|req-001|occ-1792782000000|dev-a1@1');
  assert.notEqual(occurrenceKey(identity), occurrenceKey({ ...identity, deviceEpoch: 2 }));
  assert.notEqual(occurrenceKey(identity), occurrenceKey({ ...identity, deviceId: 'dev-b2' }));
  expectDomainError(() => occurrenceKey({ ...identity, requestId: '' }), 'INVALID_ARGUMENT');
});

test('los identificadores generados no se repiten', () => {
  const ids = createIdGenerator({ now: () => 1792782000000, random: () => 0.123456789 });
  const first = ids.next();
  const second = ids.next('respond');
  assert.match(first, /^op-/);
  assert.match(second, /^respond-/);
  assert.notEqual(first, second);

  const deterministic = createDeterministicIdGenerator('test');
  assert.deepEqual([deterministic.next(), deterministic.next()], ['test-1', 'test-2']);
});
