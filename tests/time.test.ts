import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertTimeSpecConsistent,
  createTimeSpec,
  formatDateTimeInZone,
  isValidTimeZone,
  nextWeeklyOccurrence,
  nextWeeklyOccurrences,
  parseLocalDate,
  parseLocalTime,
  wallClockInZone,
  wallClockToEpochMs,
  MINUTE_MS,
  type WeeklyRecurrence,
} from '../src/domain/index.ts';
import { expectDomainError } from './helpers.ts';

const MADRID = 'Europe/Madrid';

test('resuelve una hora civil normal de Madrid', () => {
  const spec = createTimeSpec({ timeZone: MADRID, localDate: '2026-10-23', localTime: '21:00' });
  assert.equal(spec.effectiveAtEpochMs, 1792782000000);
  assert.deepEqual(wallClockInZone(spec.effectiveAtEpochMs, MADRID), {
    localDate: '2026-10-23',
    localTime: '21:00',
  });
});

test('hora inexistente por el salto de primavera se desplaza hacia delante', () => {
  // 29/03/2026 02:30 no existe en Madrid: 02:00 pasa a 03:00.
  const epoch = wallClockToEpochMs({ timeZone: MADRID, localDate: '2026-03-29', localTime: '02:30' });
  assert.equal(epoch, 1774747800000);
  assert.deepEqual(wallClockInZone(epoch, MADRID), { localDate: '2026-03-29', localTime: '03:30' });
});

test('hora repetida por el salto de otoño usa la primera ocurrencia', () => {
  const epoch = wallClockToEpochMs({ timeZone: MADRID, localDate: '2026-10-25', localTime: '02:30' });
  assert.equal(epoch, 1792888200000);
  assert.equal(epoch, new Date('2026-10-25T00:30:00.000Z').getTime());
  assert.deepEqual(wallClockInZone(epoch, MADRID), { localDate: '2026-10-25', localTime: '02:30' });
});

test('un instante que no corresponde a su hora civil se rechaza', () => {
  const spec = createTimeSpec({ timeZone: MADRID, localDate: '2026-10-23', localTime: '21:00' });
  const tampered = { ...spec, localTime: '20:00' };
  const error = expectDomainError(() => assertTimeSpecConsistent(tampered), 'INVALID_ARGUMENT');
  assert.ok(error.message.includes('hora civil'));
});

test('rechaza zonas que no son IANA', () => {
  assert.equal(isValidTimeZone(MADRID), true);
  assert.equal(isValidTimeZone('Madrid/Europa'), false);
  assert.equal(isValidTimeZone(''), false);
  expectDomainError(
    () => createTimeSpec({ timeZone: 'Madrid/Europa', localDate: '2026-10-23', localTime: '21:00' }),
    'INVALID_ARGUMENT',
  );
});

test('valida fechas y horas civiles', () => {
  assert.equal(parseLocalDate('2026-02-30'), null);
  assert.deepEqual(parseLocalDate('2026-02-28'), { year: 2026, month: 2, day: 28 });
  assert.equal(parseLocalTime('24:00'), null);
  assert.deepEqual(parseLocalTime('09:05'), { hour: 9, minute: 5 });
});

test('la recurrencia semanal conserva la hora local al cambiar el horario', () => {
  const weekly: WeeklyRecurrence = { kind: 'WEEKLY', isoWeekday: 5, localTime: '21:00' };
  const after = Date.parse('2026-10-22T09:00:00.000Z');
  const occurrences = nextWeeklyOccurrences(weekly, MADRID, after, 3);
  assert.equal(occurrences.length, 3);
  for (const occurrence of occurrences) {
    assert.equal(wallClockInZone(occurrence, MADRID).localTime, '21:00');
  }
  // 23 oct (CEST, +2) y 30 oct (CET, +1): el instante UTC se desplaza una hora.
  assert.equal(occurrences[0], 1792782000000);
  assert.equal(occurrences[1], 1793390400000);
  assert.equal(occurrences[1]! - occurrences[0]!, 7 * 24 * 60 * MINUTE_MS + 60 * MINUTE_MS);
});

test('una ocurrencia semanal que cae en hora inexistente se desplaza', () => {
  const weekly: WeeklyRecurrence = { kind: 'WEEKLY', isoWeekday: 7, localTime: '02:30' };
  const after = Date.parse('2026-03-25T00:00:00.000Z');
  const next = nextWeeklyOccurrence(weekly, MADRID, after);
  assert.equal(next, 1774747800000);
  assert.deepEqual(wallClockInZone(next!, MADRID), { localDate: '2026-03-29', localTime: '03:30' });
});

test('la recurrencia respeta untilEpochMs', () => {
  const weekly: WeeklyRecurrence = {
    kind: 'WEEKLY',
    isoWeekday: 5,
    localTime: '21:00',
    untilEpochMs: 1792782000000,
  };
  const after = Date.parse('2026-10-22T09:00:00.000Z');
  assert.equal(nextWeeklyOccurrence(weekly, MADRID, after), 1792782000000);
  assert.equal(nextWeeklyOccurrence(weekly, MADRID, 1792782000000), null);
});

test('formatea en la zona del grupo', () => {
  const formatted = formatDateTimeInZone(1792782000000, MADRID);
  assert.match(formatted, /21:00/);
});
