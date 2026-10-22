import assert from 'node:assert/strict';
import test from 'node:test';
import { reminderAt, resolveDueAt } from '../src/features/tasks/taskTime.ts';

// Jueves 22 de octubre de 2026, 10:00 local.
const NOW = new Date(2026, 9, 22, 10, 0, 0, 0);

test('una hora futura se resuelve para hoy', () => {
  const due = resolveDueAt('21:00', NOW);
  assert.ok(due);
  assert.equal(due.getFullYear(), 2026);
  assert.equal(due.getMonth(), 9);
  assert.equal(due.getDate(), 22);
  assert.equal(due.getHours(), 21);
  assert.equal(due.getMinutes(), 0);
});

test('una hora ya pasada se mueve a mañana', () => {
  const due = resolveDueAt('09:00', NOW);
  assert.ok(due);
  assert.equal(due.getDate(), 23);
  assert.equal(due.getHours(), 9);
});

test('mañana y los días de la semana se resuelven a las 09:00', () => {
  const tomorrow = resolveDueAt('mañana', NOW);
  assert.ok(tomorrow);
  assert.equal(tomorrow.getDate(), 23);
  assert.equal(tomorrow.getHours(), 9);

  const monday = resolveDueAt('lunes', NOW);
  assert.ok(monday);
  assert.equal(monday.getDate(), 26);
  assert.equal(monday.getHours(), 9);
});

test('una entrada desconocida no inventa una hora', () => {
  assert.equal(resolveDueAt('cuando pueda', NOW), null);
  assert.equal(resolveDueAt('25:99', NOW), null);
});

test('la prioridad adelanta el aviso sin cambiar la fecha límite', () => {
  const due = new Date(2026, 9, 22, 21, 0, 0, 0);
  assert.equal(reminderAt(due, 'high', NOW).getMinutes(), 50);
  assert.equal(reminderAt(due, 'normal', NOW).getMinutes(), 55);
  assert.equal(reminderAt(due, 'low', NOW).getTime(), due.getTime());
});

test('si el margen ya pasó, se avisa a la hora límite o en 30 s', () => {
  const almostDue = new Date(NOW.getTime() + 60_000);
  assert.equal(reminderAt(almostDue, 'high', NOW).getTime(), almostDue.getTime());

  const past = new Date(NOW.getTime() - 60_000);
  assert.equal(reminderAt(past, 'low', NOW).getTime(), NOW.getTime() + 30_000);
});
