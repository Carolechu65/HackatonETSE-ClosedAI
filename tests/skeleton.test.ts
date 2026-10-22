import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  completedTaskCount,
  formatEuros,
  initialSkeletonState,
  nextTask,
  parseEuros,
  pendingTasks,
  perPersonCents,
  skeletonReducer,
  unsettledTotalCents,
  type SkeletonState,
} from '../src/features/skeleton/model.ts';

const fresh = (): SkeletonState => ({ ...initialSkeletonState, tasks: [...initialSkeletonState.tasks] });

test('añadir una tarea la pone primero y limpia el texto', () => {
  const state = skeletonReducer(fresh(), { type: 'task/add', title: '  Regar plantas  ' });
  assert.equal(state.tasks[0]?.title, 'Regar plantas');
  assert.equal(state.tasks[0]?.done, false);
  assert.equal(state.tasks.length, initialSkeletonState.tasks.length + 1);
});

test('no se añaden tareas vacías ni más de seis', () => {
  const withBlank = skeletonReducer(fresh(), { type: 'task/add', title: '   ' });
  assert.equal(withBlank.tasks.length, initialSkeletonState.tasks.length);

  let state = fresh();
  for (let index = 0; index < 10; index += 1) {
    state = skeletonReducer(state, { type: 'task/add', title: `Tarea ${index}` });
  }
  assert.equal(state.tasks.length, 6);
});

test('marcar, desmarcar y quitar una tarea', () => {
  const added = skeletonReducer(fresh(), { type: 'task/add', title: 'Regar plantas' });
  const id = added.tasks[0]!.id;

  const done = skeletonReducer(added, { type: 'task/toggle', id });
  assert.equal(done.tasks[0]?.done, true);
  assert.equal(completedTaskCount(done), completedTaskCount(added) + 1);

  const undone = skeletonReducer(done, { type: 'task/toggle', id });
  assert.equal(undone.tasks[0]?.done, false);

  const removed = skeletonReducer(done, { type: 'task/remove', id });
  assert.ok(removed.tasks.every((task) => task.id !== id));
});

test('la próxima tarea es una pendiente', () => {
  const next = nextTask(fresh());
  assert.ok(next);
  assert.equal(next.done, false);
  const allDone = skeletonReducer(fresh(), { type: 'task/toggle', id: 'task-1' });
  assert.notEqual(nextTask(allDone)?.id, 'task-1');
  assert.equal(pendingTasks(allDone).length, 2);
});

test('añadir una tarea con hora y prioridad', () => {
  const state = skeletonReducer(fresh(), {
    type: 'task/add',
    title: 'Regar plantas',
    time: 'lunes',
    priority: 'high',
  });
  const task = state.tasks[0];
  assert.ok(task);
  assert.equal(task.time, 'lunes');
  assert.equal(task.priority, 'high');
  assert.equal(task.alarmStatus, 'off');
});

test('el estado de alarma se actualiza y se apaga al completar la tarea', () => {
  const scheduled = skeletonReducer(fresh(), {
    type: 'task/setAlarm',
    id: 'task-1',
    patch: { alarmEnabled: true, alarmStatus: 'scheduled', dueAt: '2026-10-22T21:00:00.000Z' },
  });
  assert.equal(scheduled.tasks[0]?.alarmStatus, 'scheduled');

  const done = skeletonReducer(scheduled, { type: 'task/toggle', id: 'task-1' });
  assert.equal(done.tasks[0]?.done, true);
  assert.equal(done.tasks[0]?.alarmEnabled, false);
  assert.equal(done.tasks[0]?.alarmStatus, 'off');
  assert.equal(done.tasks[0]?.alarmReason, null);
});

test('los gastos se añaden en céntimos y se liquidan', () => {
  const state = skeletonReducer(fresh(), { type: 'expense/add', title: 'Gasolina', amountCents: 1234 });
  const expense = state.expenses[0]!;
  assert.equal(expense.amountCents, 1234);
  assert.equal(expense.settled, false);
  assert.equal(state.expenses.length, 4);

  const settled = skeletonReducer(state, { type: 'expense/toggleSettled', id: expense.id });
  assert.equal(settled.expenses[0]?.settled, true);
  assert.ok(unsettledTotalCents(settled) < unsettledTotalCents(state));
  assert.equal(perPersonCents(settled), Math.round(unsettledTotalCents(settled) / 3));
});

test('no se añaden gastos sin importe o sin concepto', () => {
  const blank = skeletonReducer(fresh(), { type: 'expense/add', title: '   ', amountCents: 100 });
  assert.equal(blank.expenses.length, initialSkeletonState.expenses.length);
  const free = skeletonReducer(fresh(), { type: 'expense/add', title: 'Cena', amountCents: 0 });
  assert.equal(free.expenses.length, initialSkeletonState.expenses.length);
});

test('formato de euros en español', () => {
  assert.equal(formatEuros(8420), '84,20 €');
  assert.equal(formatEuros(5), '0,05 €');
  assert.equal(formatEuros(123456), '1.234,56 €');
  assert.equal(formatEuros(-150), '-1,50 €');
});

test('parseEuros acepta coma, punto y símbolo', () => {
  assert.equal(parseEuros('12'), 1200);
  assert.equal(parseEuros('12,5'), 1250);
  assert.equal(parseEuros('12.50'), 1250);
  assert.equal(parseEuros('1.234,56'), 123456);
  assert.equal(parseEuros(' 9,99 € '), 999);
  assert.equal(parseEuros(''), null);
  assert.equal(parseEuros('abc'), null);
  assert.equal(parseEuros('0'), null);
});

test('los miembros se marcan dentro o fuera', () => {
  const state = skeletonReducer(fresh(), { type: 'member/togglePresent', id: 'member-4' });
  assert.equal(state.members.find((member) => member.id === 'member-4')?.present, true);
  assert.equal(state.members.filter((member) => member.present).length, 4);
});

test('las preferencias se alternan de forma independiente', () => {
  const state = skeletonReducer(fresh(), { type: 'preferences/toggle', key: 'proposals' });
  assert.equal(state.preferences.proposals, false);
  assert.equal(state.preferences.acceptedReminders, true);
});
