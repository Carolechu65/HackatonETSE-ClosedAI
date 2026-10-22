import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cancelTask,
  completeTask,
  createTask,
  describeTaskCardState,
  describeTaskDue,
  memberInitial,
  normalizeTaskTitle,
  planLinkedAlarmWithdrawal,
  taskAfterAlarmInteraction,
  validateTaskDraft,
  type HouseholdTask,
  type TaskMember,
} from '../src/features/tasks/model.ts';
import { createDemoTaskRepository } from '../src/features/tasks/fakeRepository.ts';
import { resolveTaskAccess } from '../src/features/tasks/access.ts';
import { isDomainError } from '../src/domain/errors.ts';

const NOW = Date.parse('2026-10-22T09:00:00.000Z');
const TZ = 'Europe/Madrid';
const MEMBERS: readonly TaskMember[] = [
  { uid: 'u-marta', status: 'active' },
  { uid: 'u-luis', status: 'active' },
  { uid: 'u-baja', status: 'removed' },
];

const DRAFT = {
  title: '  Sacar   la basura ',
  assigneeUid: 'u-luis',
  activateAtEpochMs: Date.parse('2026-10-22T17:00:00.000Z'),
  dueAtEpochMs: Date.parse('2026-10-22T19:30:00.000Z'),
};

function seedTask(overrides: Partial<HouseholdTask> = {}): HouseholdTask {
  return {
    id: 'task-1',
    groupId: 'piso-4b',
    title: 'Sacar la basura',
    assigneeUid: 'u-luis',
    createdByUid: 'u-marta',
    activateAtEpochMs: null,
    dueAtEpochMs: Date.parse('2026-10-22T18:00:00.000Z'),
    status: 'pending',
    version: 3,
    completedByUid: null,
    completedAtEpochMs: null,
    ...overrides,
  };
}

test('tareas: el título se normaliza y un borrador inválido no se envía', () => {
  assert.equal(normalizeTaskTitle('  Sacar   la basura '), 'Sacar la basura');
  assert.throws(() => normalizeTaskTitle('   '), (error: unknown) => isDomainError(error) && error.code === 'INVALID_ARGUMENT');
  assert.throws(() => normalizeTaskTitle('x'.repeat(121)), (error: unknown) => isDomainError(error) && error.code === 'INVALID_ARGUMENT');

  assert.throws(
    () => validateTaskDraft({ ...DRAFT, assigneeUid: 'u-baja' }, MEMBERS),
    (error: unknown) => isDomainError(error) && error.code === 'FORBIDDEN',
  );
  assert.throws(
    () => validateTaskDraft({ ...DRAFT, assigneeUid: 'u-desconocido' }, MEMBERS),
    (error: unknown) => isDomainError(error) && error.code === 'FORBIDDEN',
  );
  assert.throws(
    () => validateTaskDraft({ ...DRAFT, dueAtEpochMs: DRAFT.activateAtEpochMs! - 1 }, MEMBERS),
    (error: unknown) => isDomainError(error) && error.code === 'INVALID_ARGUMENT',
  );

  const valid = validateTaskDraft(DRAFT, MEMBERS);
  assert.equal(valid.title, 'Sacar la basura');
  assert.equal(valid.assigneeUid, 'u-luis');
});

test('tareas: crear exige miembro activo y empieza en versión 1', () => {
  const task = createTask({ id: 'task-9', groupId: 'piso-4b', createdByUid: 'u-marta', draft: DRAFT, members: MEMBERS });
  assert.equal(task.status, 'pending');
  assert.equal(task.version, 1);
  assert.equal(task.assigneeUid, 'u-luis');
  assert.equal(task.completedByUid, null);

  assert.throws(
    () => createTask({ id: 'task-10', groupId: 'piso-4b', createdByUid: 'u-baja', draft: DRAFT, members: MEMBERS }),
    (error: unknown) => isDomainError(error) && error.code === 'FORBIDDEN',
  );
});

test('tareas: completar dos veces es idempotente y no duplica la retirada de alarmas', () => {
  const task = seedTask();
  const first = completeTask(task, { actorUid: 'u-luis', members: MEMBERS, nowEpochMs: NOW });
  assert.equal(first.outcome, 'applied');
  assert.equal(first.task.status, 'completed');
  assert.equal(first.task.version, 4);
  assert.equal(first.task.completedByUid, 'u-luis');
  assert.equal(first.invalidatesLinkedAlarms, true);

  const second = completeTask(first.task, { actorUid: 'u-marta', members: MEMBERS, nowEpochMs: NOW + 1_000 });
  assert.equal(second.outcome, 'already_completed');
  assert.equal(second.changed, false);
  assert.equal(second.invalidatesLinkedAlarms, false);
  assert.equal(second.task.version, 4);
  assert.equal(second.task.completedByUid, 'u-luis');

  assert.throws(
    () => completeTask(seedTask({ status: 'cancelled' }), { actorUid: 'u-luis', members: MEMBERS, nowEpochMs: NOW }),
    (error: unknown) => isDomainError(error) && error.code === 'INVALID_ARGUMENT',
  );
  assert.throws(
    () => completeTask(seedTask(), { actorUid: 'u-baja', members: MEMBERS, nowEpochMs: NOW }),
    (error: unknown) => isDomainError(error) && error.code === 'FORBIDDEN',
  );
});

test('tareas: cancelar es idempotente y no se puede cancelar una completada', () => {
  const first = cancelTask(seedTask(), { actorUid: 'u-marta', members: MEMBERS, nowEpochMs: NOW });
  assert.equal(first.outcome, 'applied');
  assert.equal(first.task.status, 'cancelled');
  assert.equal(first.task.version, 4);

  const second = cancelTask(first.task, { actorUid: 'u-luis', members: MEMBERS, nowEpochMs: NOW });
  assert.equal(second.outcome, 'already_cancelled');
  assert.equal(second.task.version, 4);

  assert.throws(
    () => cancelTask(seedTask({ status: 'completed' }), { actorUid: 'u-marta', members: MEMBERS, nowEpochMs: NOW }),
    (error: unknown) => isDomainError(error) && error.code === 'INVALID_ARGUMENT',
  );
});

test('tareas: detener o posponer una alarma nunca completa la tarea', () => {
  const task = seedTask();
  const afterAlarm = taskAfterAlarmInteraction(task);
  assert.equal(afterAlarm, task);
  assert.equal(afterAlarm.status, 'pending');
  assert.equal(afterAlarm.version, 3);
  assert.equal(afterAlarm.completedByUid, null);
  assert.equal(afterAlarm.dueAtEpochMs, task.dueAtEpochMs);
});

test('tareas: el plan de retirada solo existe al cerrar la tarea y deduplica alarmas', () => {
  assert.equal(planLinkedAlarmWithdrawal(seedTask(), [{ requestId: 'req-1', occurrenceId: 'occ-1' }]), null);

  const completed = completeTask(seedTask(), { actorUid: 'u-luis', members: MEMBERS, nowEpochMs: NOW }).task;
  const plan = planLinkedAlarmWithdrawal(completed, [
    { requestId: 'req-2', occurrenceId: 'occ-2' },
    { requestId: 'req-1', occurrenceId: 'occ-1' },
    { requestId: 'req-2', occurrenceId: 'occ-9' },
  ]);
  assert.deepEqual(plan, {
    kind: 'withdrawLinkedAlarms',
    taskId: 'task-1',
    reason: 'task_completed',
    requestIds: ['req-1', 'req-2'],
  });

  const withoutLinks = planLinkedAlarmWithdrawal(completed, []);
  assert.equal(withoutLinks, null);
});

test('tareas: los estados de escritura no afirman éxito sin confirmación', () => {
  const task = seedTask();
  assert.equal(describeTaskCardState(task).label, 'Pendiente');
  assert.equal(describeTaskCardState(task, { sync: 'CONFLICT', alarmWithdrawal: 'none' }).tone, 'error');
  assert.equal(describeTaskCardState(task, { sync: 'QUEUED', alarmWithdrawal: 'none' }).label, 'Guardando…');
  assert.equal(describeTaskCardState(task, { sync: 'FAILED_PERMANENT', alarmWithdrawal: 'none' }).tone, 'error');

  const withdrawal = describeTaskCardState(task, { sync: 'CONFIRMED', alarmWithdrawal: 'pending' });
  assert.equal(withdrawal.label, 'Pendiente');
  assert.match(withdrawal.detail ?? '', /sin acuse/);

  const completed = completeTask(task, { actorUid: 'u-luis', members: MEMBERS, nowEpochMs: NOW }).task;
  assert.equal(describeTaskCardState(completed, { sync: 'CONFIRMED', alarmWithdrawal: 'confirmed' }).label, 'Completada');
});

test('tareas: vencimiento legible en la zona inyectada', () => {
  assert.equal(describeTaskDue(seedTask(), NOW, TZ), 'Vence hoy · 20:00');
  const tomorrow = seedTask({ dueAtEpochMs: Date.parse('2026-10-23T07:00:00.000Z') });
  assert.equal(describeTaskDue(tomorrow, NOW, TZ), 'Vence mañana · 09:00');
  const past = seedTask({ dueAtEpochMs: Date.parse('2026-10-21T07:00:00.000Z') });
  assert.equal(describeTaskDue(past, NOW, TZ), 'Venció el 21 · 09:00');
  assert.equal(describeTaskDue(seedTask({ dueAtEpochMs: null }), NOW, TZ), 'Sin fecha');
});

test('tareas: el acceso a una tarea ajena se trata como inexistente', () => {
  const task = seedTask();
  assert.equal(resolveTaskAccess(task, null), 'sign_in_required');
  assert.equal(resolveTaskAccess(null, { userId: 'u-marta', groupIds: ['piso-4b'] }), 'not_found');
  assert.equal(resolveTaskAccess(task, { userId: 'u-marta', groupIds: ['otro-piso'] }), 'not_found');
  assert.equal(resolveTaskAccess(task, { userId: 'u-marta', groupIds: ['piso-4b'] }), 'ok');
});

test('tareas: el repositorio demo aplica versión, conflicto y reintento idempotente', async () => {
  const repository = createDemoTaskRepository({
    groupId: 'piso-4b',
    members: MEMBERS,
    actorUid: 'u-marta',
    tasks: [seedTask()],
    idFactory: () => 'task-2',
  });

  await repository.submit({
    kind: 'createTask',
    operationId: 'op-create',
    groupId: 'piso-4b',
    draft: { ...DRAFT, title: 'Comprar café' },
  });
  assert.equal(repository.tasks.length, 2);

  const created = repository.tasks.find((task) => task.id === 'task-1')!;
  const completeCommand = {
    kind: 'completeTask' as const,
    operationId: 'op-complete',
    groupId: 'piso-4b',
    taskId: created.id,
    expectedVersion: created.version,
    completedAtEpochMs: NOW,
  };
  await repository.submit(completeCommand);
  const afterFirst = repository.tasks.find((task) => task.id === 'task-1')!;
  assert.equal(afterFirst.status, 'completed');
  assert.equal(afterFirst.version, 4);

  // Repetir el mismo operationId devuelve el recibo guardado sin volver a mutar.
  await repository.submit(completeCommand);
  assert.equal(repository.tasks.find((task) => task.id === 'task-1')!.version, 4);

  await assert.rejects(
    repository.submit({ ...completeCommand, operationId: 'op-stale', expectedVersion: 1 }),
    (error: unknown) => isDomainError(error) && error.code === 'VERSION_CONFLICT',
  );

  repository.failNext();
  await assert.rejects(
    repository.submit({
      kind: 'cancelTask',
      operationId: 'op-cancel',
      groupId: 'piso-4b',
      taskId: 'task-2',
      expectedVersion: 1,
      cancelledAtEpochMs: NOW,
    }),
    (error: unknown) => isDomainError(error) && error.code === 'TEMPORARY_UNAVAILABLE',
  );
  assert.equal(repository.tasks.find((task) => task.id === 'task-2')!.status, 'pending');
});

test('tareas: inicial del avatar sin inventar nombres', () => {
  assert.equal(memberInitial('Marta', 'u-marta'), 'M');
  assert.equal(memberInitial(null, 'u-luis'), 'U');
  assert.equal(memberInitial('  ', 'u-x'), '?');
});
