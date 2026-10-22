import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adoptSnapshotForSession,
  buildWidgetSnapshot,
  createSignedOutWidgetSnapshot,
  isWidgetSnapshotStale,
  scaffoldAlarmInput,
  snapshotHasContent,
  truncateWidgetTitle,
  WIDGET_SNAPSHOT_SCHEMA_VERSION,
  type WidgetAlarmInput,
} from '../src/widgets/snapshot.ts';
import { toWidgetProps, formatAlarmWhen, describeFreshness, formatPendingLine } from '../src/widgets/viewModel.ts';
import { alarmLink, inboxLink, parseWidgetLink, taskLink, widgetLinkToRoute } from '../src/widgets/links.ts';
import { isDomainError } from '../src/domain/errors.ts';

const NOW = Date.parse('2026-10-22T17:05:00.000Z');
const TZ = 'Europe/Madrid';
const SCOPE = { userId: 'u-marta', groupId: 'piso-4b' };

function alarm(overrides: Partial<WidgetAlarmInput> & Pick<WidgetAlarmInput, 'requestId'>): WidgetAlarmInput {
  return {
    title: 'Tarea del piso',
    proposal: 'ACTIVE',
    decision: 'ACCEPTED',
    scheduling: 'SCHEDULED',
    occurrenceId: 'occ-1',
    scheduledAtEpochMs: NOW + 60 * 60_000,
    mode: 'ALARM',
    ...overrides,
  };
}

test('widget: solo una ocurrencia aceptada, programada y futura es la próxima alarma', () => {
  const snapshot = buildWidgetSnapshot({
    nowEpochMs: NOW,
    scope: SCOPE,
    alarms: [
      alarm({ requestId: 'future', scheduledAtEpochMs: NOW + 3_600_000 }),
      alarm({ requestId: 'past', scheduledAtEpochMs: NOW - 1_000 }),
      alarm({ requestId: 'pending', decision: 'PENDING' }),
      alarm({ requestId: 'rejected', decision: 'REJECTED' }),
      alarm({ requestId: 'disabled', decision: 'DISABLED' }),
      alarm({ requestId: 'review', decision: 'NEEDS_REVIEW' }),
      alarm({ requestId: 'not-scheduled', scheduling: 'NOT_SCHEDULED' }),
      alarm({ requestId: 'permission', scheduling: 'PENDING_PERMISSION' }),
      alarm({ requestId: 'withdrawn', proposal: 'WITHDRAWN' }),
      alarm({ requestId: 'expired', proposal: 'EXPIRED' }),
      alarm({ requestId: 'cancel-pending', scheduling: 'CANCEL_PENDING' }),
      alarm({ requestId: 'fired', scheduling: 'FIRED' }),
    ],
  });

  assert.equal(snapshot.nextAlarm?.requestId, 'future');
  assert.equal(snapshot.counts.pendingProposals, 2);
  assert.equal(snapshot.counts.pendingActivations, 2);
  assert.equal(snapshot.counts.withdrawalPending, 1);
});

test('widget: dos alarmas desordenadas eligen la más cercana y desempatan de forma estable', () => {
  const late = alarm({ requestId: 'z-late', scheduledAtEpochMs: NOW + 7_200_000 });
  const early = alarm({ requestId: 'a-early', scheduledAtEpochMs: NOW + 1_800_000 });
  const tieA = alarm({ requestId: 'b-tie', occurrenceId: 'occ-2', scheduledAtEpochMs: NOW + 1_800_000 });
  const tieB = alarm({ requestId: 'c-tie', occurrenceId: 'occ-3', scheduledAtEpochMs: NOW + 1_800_000 });

  const snapshot = buildWidgetSnapshot({ nowEpochMs: NOW, scope: SCOPE, alarms: [late, tieB, early, tieA] });
  assert.equal(snapshot.nextAlarm?.requestId, 'a-early');

  const tieSnapshot = buildWidgetSnapshot({ nowEpochMs: NOW, scope: SCOPE, alarms: [tieB, tieA] });
  assert.equal(tieSnapshot.nextAlarm?.requestId, 'b-tie');
  assert.deepEqual(tieSnapshot, buildWidgetSnapshot({ nowEpochMs: NOW, scope: SCOPE, alarms: [tieA, tieB] }));
});

test('widget: el título se acota sin romper palabras y el snapshot es serializable', () => {
  assert.equal(truncateWidgetTitle('  Pagar   la luz  '), 'Pagar la luz');
  const long = truncateWidgetTitle('Comprar '.repeat(20));
  assert.ok(long.length <= 64, `longitud ${long.length}`);
  assert.ok(long.endsWith('…'));

  const snapshot = buildWidgetSnapshot({ nowEpochMs: NOW, scope: SCOPE, alarms: [alarm({ requestId: 'x' })] });
  assert.equal(snapshot.schemaVersion, WIDGET_SNAPSHOT_SCHEMA_VERSION);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
});

test('widget: sesión cerrada no conserva contenido y no reutiliza datos de otra cuenta', () => {
  const snapshot = buildWidgetSnapshot({ nowEpochMs: NOW, scope: SCOPE, alarms: [alarm({ requestId: 'x' })] });
  assert.equal(snapshotHasContent(snapshot), true);

  const signedOut = createSignedOutWidgetSnapshot(NOW);
  assert.equal(signedOut.scope, null);
  assert.equal(signedOut.nextAlarm, null);
  assert.deepEqual(signedOut.counts, { pendingProposals: 0, pendingActivations: 0, withdrawalPending: 0 });

  const otherUser = adoptSnapshotForSession(snapshot, { userId: 'u-luis', groupId: SCOPE.groupId }, NOW);
  assert.equal(otherUser.scope, null);
  assert.equal(otherUser.nextAlarm, null);

  const otherGroup = adoptSnapshotForSession(snapshot, { userId: SCOPE.userId, groupId: 'otro-piso' }, NOW);
  assert.equal(otherGroup.scope, null);

  const sameSession = adoptSnapshotForSession(snapshot, SCOPE, NOW);
  assert.equal(sameSession.nextAlarm?.requestId, 'x');

  const loggedOut = adoptSnapshotForSession(snapshot, null, NOW);
  assert.equal(loggedOut.scope, null);
});

test('widget: la frescura marca datos viejos y relojes incoherentes sin ocultarlos', () => {
  const snapshot = buildWidgetSnapshot({ nowEpochMs: NOW, scope: SCOPE, alarms: [] });
  assert.equal(isWidgetSnapshotStale(snapshot, NOW + 60_000), false);
  assert.equal(isWidgetSnapshotStale(snapshot, NOW + 31 * 60_000), true);
  assert.equal(isWidgetSnapshotStale(snapshot, NOW - 1), true);
  assert.equal(isWidgetSnapshotStale(snapshot, NOW, 0), false);
  assert.equal(isWidgetSnapshotStale(createSignedOutWidgetSnapshot(NOW), NOW + 10 * 86_400_000), false);
});

test('widget: adaptador del scaffold traduce sin afirmar programación', () => {
  const pending = scaffoldAlarmInput({
    id: 'req-1',
    title: 'Sacar la basura',
    proposedBy: 'Luis',
    scheduledAt: new Date(NOW + 3_600_000).toISOString(),
    decision: 'pending',
    scheduling: 'not_scheduled',
  });
  assert.equal(pending.decision, 'PENDING');
  assert.equal(pending.scheduling, 'NOT_SCHEDULED');

  const accepted = scaffoldAlarmInput({
    id: 'req-2',
    title: 'Pagar la luz',
    proposedBy: 'Marta',
    scheduledAt: new Date(NOW + 3_600_000).toISOString(),
    decision: 'accepted',
    scheduling: 'pending_activation',
  });
  assert.equal(accepted.decision, 'ACCEPTED');
  assert.equal(accepted.scheduling, 'PENDING_PERMISSION');

  const snapshot = buildWidgetSnapshot({ nowEpochMs: NOW, scope: SCOPE, alarms: [pending, accepted] });
  assert.equal(snapshot.nextAlarm, null, 'aceptada sin programar no puede ser la próxima alarma');
  assert.equal(snapshot.counts.pendingProposals, 1);
  assert.equal(snapshot.counts.pendingActivations, 1);
});

test('widget: un instante inválido no produce un snapshot silencioso', () => {
  assert.throws(
    () => buildWidgetSnapshot({ nowEpochMs: Number.NaN, scope: SCOPE, alarms: [] }),
    (error: unknown) => isDomainError(error) && error.code === 'INVALID_ARGUMENT',
  );
  assert.throws(
    () => buildWidgetSnapshot({ nowEpochMs: NOW, scope: { userId: '../x', groupId: 'g' }, alarms: [] }),
    (error: unknown) => isDomainError(error) && error.code === 'INVALID_ARGUMENT',
  );
});

test('view model: fecha relativa en la zona inyectada', () => {
  const target = Date.parse('2026-10-22T19:30:00.000Z'); // 21:30 en Madrid
  assert.equal(formatAlarmWhen(target, NOW, TZ), 'Hoy · 21:30');
  const tomorrow = Date.parse('2026-10-23T06:00:00.000Z'); // 08:00 en Madrid
  assert.equal(formatAlarmWhen(tomorrow, NOW, TZ), 'Mañana · 08:00');
  const later = Date.parse('2026-10-26T08:00:00.000Z');
  assert.equal(formatAlarmWhen(later, NOW, TZ), 'Lun 26 · 09:00');
});

test('view model: frescura, pendientes y estados vacíos', () => {
  assert.equal(describeFreshness(NOW, NOW + 10_000), 'ahora mismo');
  assert.equal(describeFreshness(NOW, NOW + 5 * 60_000), 'hace 5 min');
  assert.equal(describeFreshness(NOW, NOW + 3 * 3_600_000), 'hace 3 h');
  assert.equal(describeFreshness(NOW, NOW + 2 * 86_400_000), 'hace 2 d');

  const snapshot = buildWidgetSnapshot({
    nowEpochMs: NOW,
    scope: SCOPE,
    alarms: [
      alarm({ requestId: 'next', title: 'Pagar la luz', scheduledAtEpochMs: Date.parse('2026-10-22T19:30:00.000Z') }),
      alarm({ requestId: 'p1', decision: 'PENDING' }),
      alarm({ requestId: 'p2', decision: 'NEEDS_REVIEW' }),
      alarm({ requestId: 'a1', decision: 'ACCEPTED', scheduling: 'FAILED' }),
      alarm({ requestId: 'w1', scheduling: 'CANCEL_PENDING' }),
    ],
  });
  assert.equal(formatPendingLine(snapshot), '2 propuestas · 1 por activar · 1 sin acuse');

  const props = toWidgetProps(snapshot, NOW + 3 * 3_600_000, { timeZone: TZ });
  assert.equal(props.headline, 'Pagar la luz');
  assert.equal(props.when, 'Hoy · 21:30');
  assert.equal(props.stale, true);
  assert.equal(props.updated, 'Actualizado hace 3 h');
  assert.equal(props.freshness, 'hace 3 h');
  assert.equal(props.alarmUrl, 'alarmat://alarm/next');
  assert.equal(props.inboxUrl, 'alarmat:///');

  const empty = toWidgetProps(buildWidgetSnapshot({ nowEpochMs: NOW, scope: SCOPE, alarms: [] }), NOW, { timeZone: TZ });
  assert.equal(empty.headline, 'Nada a la vista');
  assert.equal(empty.alarmUrl, null);

  const onlyPending = toWidgetProps(buildWidgetSnapshot({
    nowEpochMs: NOW,
    scope: SCOPE,
    alarms: [alarm({ requestId: 'p1', decision: 'PENDING' })],
  }), NOW, { timeZone: TZ });
  assert.equal(onlyPending.headline, 'Tienes propuestas');
  assert.match(onlyPending.emptyBody, /1 propuesta espera/);

  const signedOut = toWidgetProps(createSignedOutWidgetSnapshot(NOW), NOW, { timeZone: TZ });
  assert.equal(signedOut.signedIn, false);
  assert.equal(signedOut.headline, 'Abre AlarmaT');
  assert.equal(signedOut.alarmUrl, null);
});

test('enlaces: construyen rutas válidas y rechazan cualquier intento de decisión', () => {
  assert.equal(inboxLink(), 'alarmat:///');
  assert.equal(alarmLink('req-1'), 'alarmat://alarm/req-1');
  assert.equal(taskLink('task_2'), 'alarmat://task/task_2');

  assert.deepEqual(parseWidgetLink('alarmat://alarm/req-1'), { kind: 'alarm', requestId: 'req-1' });
  assert.deepEqual(parseWidgetLink('alarmat://task/task_2'), { kind: 'task', taskId: 'task_2' });
  assert.deepEqual(parseWidgetLink('alarmat:///'), { kind: 'inbox' });
  assert.equal(widgetLinkToRoute('alarmat://alarm/req-1'), '/alarm/req-1');
  assert.equal(widgetLinkToRoute('alarmat://task/t-1'), '/task/t-1');

  assert.equal(parseWidgetLink('alarmat://alarm/req-1?decision=ACCEPTED'), null);
  assert.equal(parseWidgetLink('alarmat://alarm/req-1#accept'), null);
  assert.equal(parseWidgetLink('https://alarmat.app/alarm/req-1'), null);
  assert.equal(parseWidgetLink('alarmat://evil.com/alarm/req-1'), null);
  assert.equal(parseWidgetLink('alarmat://group/invite/abc'), null);
  assert.equal(parseWidgetLink('alarmat://alarm/..'), null);
  assert.equal(parseWidgetLink('alarmat://alarm/%2e%2e'), null);
  assert.equal(parseWidgetLink('alarmat://alarm/'), null);
  assert.equal(parseWidgetLink('javascript:alert(1)'), null);
  assert.equal(parseWidgetLink(42), null);

  assert.throws(() => alarmLink('../escape'), /inválido/);
  assert.throws(() => taskLink('a/b'), /inválido/);
});
