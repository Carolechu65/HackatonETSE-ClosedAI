import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSelectedWidget } from '../src/composition/widgetProjection.ts';
import type { PersistedWidgetSnapshot } from '../src/data/repositories/alarmRepository.ts';

const snapshot: PersistedWidgetSnapshot = {
  schemaVersion: 1, userId: 'ana', generatedAtEpochMs: 5000, lastSyncedAtEpochMs: 1000, stale: true,
  groups: [
    { groupId: 'casa-a', pendingProposals: 7, pendingActivation: 2, pendingChanges: 0, cancelPending: 1, nextAlarm: null },
    { groupId: 'casa-b', pendingProposals: 1, pendingActivation: 0, pendingChanges: 0, cancelPending: 0, nextAlarm: {
      requestId: 'aviso-b', occurrenceId: 'oc-b', mode: 'ALARM', title: 'Cocina', proposedBy: 'luis', effectiveAtEpochMs: 9000, deepLink: 'alarmat://alarm/aviso-b', acknowledgementPending: false,
    } },
  ],
};
test('widget follows the selected household and preserves actual sync age', () => {
  const projected = projectSelectedWidget(snapshot, 'casa-b')!;
  assert.deepEqual(projected.scope, { userId: 'ana', groupId: 'casa-b' });
  assert.equal(projected.nextAlarm?.requestId, 'aviso-b');
  assert.equal(projected.counts.pendingProposals, 1);
  assert.equal(projected.generatedAtEpochMs, 1000);
});
test('an empty selected household does not display another household alarms', () => {
  const projected = projectSelectedWidget(snapshot, 'casa-sin-avisos')!;
  assert.equal(projected.scope?.groupId, 'casa-sin-avisos');
  assert.equal(projected.nextAlarm, null);
  assert.deepEqual(projected.counts, { pendingProposals: 0, pendingActivations: 0, withdrawalPending: 0 });
});
test('widget uses a default only before choosing a household and clears an empty account', () => {
  assert.equal(projectSelectedWidget(snapshot, null)?.scope?.groupId, 'casa-a');
  assert.equal(projectSelectedWidget({ ...snapshot, groups: [] }, null), null);
  assert.equal(projectSelectedWidget({ ...snapshot, lastSyncedAtEpochMs: null }, 'casa-a')?.generatedAtEpochMs, 0);
});

import { isValidWidgetTaskProjection, projectWidgetTasks } from '../src/composition/widgetProjection.ts';
import { adoptSnapshotForSession, WIDGET_TASK_LIMIT } from '../src/widgets/snapshot.ts';
import { toWidgetProps } from '../src/widgets/viewModel.ts';
import type { HouseholdTask } from '../src/features/tasks/model.ts';

const task = (patch: Partial<HouseholdTask> = {}): HouseholdTask => ({
  id: 'lavar', groupId: 'casa-b', title: 'Lavar los platos', assigneeUid: 'ana', createdByUid: 'ana',
  activateAtEpochMs: null, dueAtEpochMs: 5000, status: 'pending', version: 1,
  completedByUid: null, completedAtEpochMs: null, ...patch,
});
const context = (tasks: HouseholdTask[]) => ({ userId: 'ana', groupId: 'casa-b', generatedAtEpochMs: 2000,
  timeZone: 'Europe/Madrid', members: [{ userId: 'luis', displayName: 'Luis', role: 'member' }], tasks });

test('task board includes pending titles, assignees, dates and links only from selected household', () => {
  const tasks = projectWidgetTasks(context([
    task(), task({ id: 'otra', groupId: 'casa-a' }), task({ id: 'hecha', status: 'completed' }),
    task({ id: 'cancelada', status: 'cancelled' }), task({ id: 'compra', title: 'Comprar pan', assigneeUid: 'luis', dueAtEpochMs: null }),
  ]));
  const projected = projectSelectedWidget(snapshot, 'casa-b', tasks)!;
  assert.deepEqual(projected.tasks.map(item => item.id), ['lavar', 'compra', 'hecha']);
  assert.equal(projected.tasks[2]?.completed, true);
  const props = toWidgetProps(projected, 3000, { timeZone: 'Europe/Madrid' });
  assert.equal(props.taskCount, 2);
  assert.equal(props.tasks[0]?.title, 'Lavar los platos');
  assert.match(props.tasks[0]!.detail, /^Tú · /);
  assert.equal(props.tasks[0]?.url, 'alarmat://task/lavar');
  assert.equal(props.tasks[0]?.actionTarget, 'alarmat-task:ana:casa-b:lavar:1:completed');
  assert.equal(props.tasks[2]?.actionTarget, 'alarmat-task:ana:casa-b:hecha:1:pending');
  assert.equal(props.tasks[1]?.detail, 'Luis · Sin fecha');
  assert.equal(projected.generatedAtEpochMs, 1000, 'task refresh does not disguise old alarm sync');
  assert.deepEqual(projectSelectedWidget(snapshot, 'casa-a', tasks)?.tasks, []);
  assert.deepEqual(projectSelectedWidget({ ...snapshot, userId: 'otro' }, 'casa-b', tasks)?.tasks, []);
  assert.deepEqual(adoptSnapshotForSession(projected, null, 3000).tasks, []);
});

test('task-only household renders, completion checks a task and reopening unchecks it', () => {
  const emptyAlarms = { ...snapshot, groups: [] };
  const project = (status: HouseholdTask['status']) => projectSelectedWidget(emptyAlarms, 'casa-b', projectWidgetTasks(context([task({ status })])))!;
  assert.equal(project('pending').tasks.length, 1);
  assert.equal(project('pending').generatedAtEpochMs, 2000);
  assert.equal(project('completed').tasks[0]?.completed, true);
  assert.equal(project('completed').pendingTaskCount, 0);
  assert.equal(project('pending').tasks[0]?.completed, false);
  assert.equal(project('pending').pendingTaskCount, 1);
});

test('task cache is bounded with honest total and rejects corrupt or wrong-schema payloads', () => {
  const tasks = projectWidgetTasks(context(Array.from({ length: 25 }, (_, index) => task({ id: `t-${index}`, dueAtEpochMs: index }))));
  assert.equal(tasks.snapshot.tasks.length, WIDGET_TASK_LIMIT);
  assert.equal(tasks.snapshot.pendingTaskCount, 25);
  assert.match(toWidgetProps(tasks.snapshot, 3000).taskSummary, /25 tareas pendientes · primeras 20/);
  assert.ok(isValidWidgetTaskProjection(JSON.parse(JSON.stringify(tasks))));
  assert.equal(isValidWidgetTaskProjection({ ...tasks, timeZone: 'not-a-zone' }), false);
  assert.equal(isValidWidgetTaskProjection({ ...tasks, snapshot: { ...tasks.snapshot, schemaVersion: 2 } }), false);
  assert.equal(isValidWidgetTaskProjection({ ...tasks, snapshot: { ...tasks.snapshot, tasks: [{ id: '../bad' }] } }), false);
});


test('completed checklist history is limited to five recent tasks after pending work', () => {
  const tasks = projectWidgetTasks(context([task(), ...Array.from({ length: 9 }, (_, index) =>
    task({ id: `done-${index}`, status: 'completed', completedAtEpochMs: index }))]));
  assert.equal(tasks.snapshot.tasks.length, 6);
  assert.equal(tasks.snapshot.pendingTaskCount, 1);
  assert.deepEqual(tasks.snapshot.tasks.slice(1).map(task => task.id), ['done-8', 'done-7', 'done-6', 'done-5', 'done-4']);
});

test('unaccepted or rejected task assignment cannot generate a widget completion action', () => {
  for (const assignmentDecision of ['pending', 'rejected'] as const) {
    const projected = projectWidgetTasks(context([task({ assignmentDecision })]));
    const props = toWidgetProps(projected.snapshot, 3000);
    assert.equal(props.tasks[0]?.actionTarget, '');
    assert.match(props.tasks[0]!.detail, /Pendiente de aceptar|Asignación rechazada/);
  }
});
