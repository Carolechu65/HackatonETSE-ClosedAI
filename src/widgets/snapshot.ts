/**
 * P6 · Proyección del widget (contrato v3).
 *
 * Selecciona, de forma pura y reproducible, lo que el launcher puede mostrar:
 * la próxima ocurrencia **confirmada y futura**, y contadores separados de
 * propuestas pendientes, activaciones sin confirmar y retiradas sin acuse.
 *
 * Reglas que este módulo hace cumplir (TDD §3 y §4):
 * - Aceptar no es programar: solo `SCHEDULED` con instante futuro alimenta `nextAlarm`.
 * - Rechazada, retirada, caducada, desactivada o pendiente nunca aparece como activa.
 * - Una retirada pendiente (`CANCEL_PENDING`) se cuenta aparte y no se presenta como cancelada.
 * - El reloj se inyecta; dos ejecuciones con el mismo reloj producen el mismo snapshot.
 * - El snapshot está acotado a un usuario y un grupo: al cambiar de sesión no se
 *   reutiliza el contenido anterior (`adoptSnapshotForSession`).
 *
 * Los enums son los del TDD (`src/domain/states.ts`). El adaptador
 * `scaffoldAlarmInput` traduce la proyección simplificada de la bandeja sin crear
 * un segundo modelo de estados.
 */
import type { TaskAssignmentDecision } from '../features/tasks/model.ts';
import type { AlarmSummary } from '../domain/alarms.ts';
import { DomainError } from '../domain/errors.ts';
import type { Decision, Mode, ProposalStatus, SchedulingStatus } from '../domain/states.ts';

/** Sube de versión cuando cambia la forma del snapshot que consume el widget. */
export const WIDGET_SNAPSHOT_SCHEMA_VERSION = 3;

/** Edad a partir de la cual el widget avisa de que la información puede estar obsoleta. */
export const WIDGET_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1_000;

/** El título se acota para que cada tarjeta sea legible en el launcher. */
export const WIDGET_TITLE_MAX_LENGTH = 64;

/**
 * Contenido privado que el widget puede mostrar. `null` significa cerrado de sesión:
 * no hay usuario ni grupo, y el widget debe quedar vacío.
 */
export type WidgetSnapshotScope = {
  readonly userId: string;
  readonly groupId: string;
};

/**
 * Vista normalizada de una propuesta para el widget. No es un modelo nuevo:
 * cada campo procede de un eje del contrato v1.
 */
export type WidgetAlarmInput = {
  readonly requestId: string;
  readonly title: string;
  readonly proposal: ProposalStatus;
  readonly decision: Decision;
  readonly scheduling: SchedulingStatus;
  /** Identidad estable de la ocurrencia (`occ-…`); `null` en propuestas puntuales del scaffold. */
  readonly occurrenceId: string | null;
  readonly scheduledAtEpochMs: number | null;
  readonly mode: Mode;
};

export type WidgetNextAlarm = {
  readonly requestId: string;
  readonly occurrenceId: string | null;
  readonly title: string;
  readonly scheduledAtEpochMs: number;
  readonly mode: Mode;
};

export type WidgetSnapshotCounts = {
  /** Propuestas activas que esperan decisión del destinatario (`PENDING` o `NEEDS_REVIEW`). */
  readonly pendingProposals: number;
  /** Aceptadas que aún no tienen confirmación local de programación. */
  readonly pendingActivations: number;
  /** Retiradas solicitadas sin acuse del dispositivo. */
  readonly withdrawalPending: number;
};

export const WIDGET_TASK_LIMIT = 20;

export type WidgetTask = {
  readonly id: string;
  readonly title: string;
  readonly assigneeLabel: string;
  readonly completed: boolean;
  readonly version: number;
  readonly assignmentDecision?: TaskAssignmentDecision;
  readonly dueAtEpochMs: number | null;
};

export type WidgetTaskInput = Omit<WidgetTask, 'completed'> & {
  readonly completedAtEpochMs?: number | null;
  readonly groupId: string;
  readonly status: 'pending' | 'completed' | 'cancelled';
};

export type WidgetSnapshot = {
  readonly schemaVersion: typeof WIDGET_SNAPSHOT_SCHEMA_VERSION;
  readonly scope: WidgetSnapshotScope | null;
  /** Instante en que la app generó esta proyección (no cuándo la pintó el launcher). */
  readonly generatedAtEpochMs: number;
  readonly nextAlarm: WidgetNextAlarm | null;
  readonly counts: WidgetSnapshotCounts;
  readonly tasks: readonly WidgetTask[];
  readonly pendingTaskCount: number;
};

export type BuildWidgetSnapshotInput = {
  readonly alarms: readonly WidgetAlarmInput[];
  readonly tasks?: readonly WidgetTaskInput[];
  readonly nowEpochMs: number;
  readonly scope: WidgetSnapshotScope | null;
  /**
   * Momento de generación cuando la proyección se publica más tarde (por ejemplo,
   * al reconciliar en segundo plano). Por defecto coincide con `nowEpochMs`.
   * La selección de la próxima alarma siempre usa `nowEpochMs`.
   */
  readonly generatedAtEpochMs?: number;
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function assertEpochMs(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new DomainError('INVALID_ARGUMENT', `Instante inválido en ${field}.`, { field });
  }
}

function assertIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new DomainError('INVALID_ARGUMENT', `Identificador inválido en ${field}.`, { field });
  }
}

/** Colapsa espacios y recorta sin cortar a mitad de palabra cuando es posible. */
export function truncateWidgetTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (clean.length <= WIDGET_TITLE_MAX_LENGTH) return clean;
  const cut = clean.slice(0, WIDGET_TITLE_MAX_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > WIDGET_TITLE_MAX_LENGTH * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

function isFutureScheduled(alarm: WidgetAlarmInput, nowEpochMs: number): boolean {
  return alarm.proposal === 'ACTIVE'
    && alarm.decision === 'ACCEPTED'
    && alarm.scheduling === 'SCHEDULED'
    && alarm.scheduledAtEpochMs !== null
    && alarm.scheduledAtEpochMs > nowEpochMs;
}

function compareStable(a: WidgetAlarmInput, b: WidgetAlarmInput): number {
  const byTime = (a.scheduledAtEpochMs ?? 0) - (b.scheduledAtEpochMs ?? 0);
  if (byTime !== 0) return byTime;
  if (a.requestId !== b.requestId) return a.requestId < b.requestId ? -1 : 1;
  const aOccurrence = a.occurrenceId ?? '';
  const bOccurrence = b.occurrenceId ?? '';
  if (aOccurrence === bOccurrence) return 0;
  return aOccurrence < bOccurrence ? -1 : 1;
}

/** Estados aceptados que todavía no demuestran programación local. */
const PENDING_ACTIVATION_STATES: readonly SchedulingStatus[] = [
  'NOT_SCHEDULED',
  'PENDING_PERMISSION',
  'SCHEDULING',
  'FAILED',
];

/**
 * Proyección pura. No instala, publica ni refresca ningún widget Android.
 * Con `scope: null` devuelve un snapshot vacío (sesión cerrada) aunque lleguen alarmas.
 */
export function buildWidgetSnapshot(input: BuildWidgetSnapshotInput): WidgetSnapshot {
  assertEpochMs(input.nowEpochMs, 'nowEpochMs');
  const generatedAtEpochMs = input.generatedAtEpochMs ?? input.nowEpochMs;
  assertEpochMs(generatedAtEpochMs, 'generatedAtEpochMs');

  if (input.scope === null) {
    return createSignedOutWidgetSnapshot(generatedAtEpochMs);
  }

  assertIdentifier(input.scope.userId, 'scope.userId');
  assertIdentifier(input.scope.groupId, 'scope.groupId');

  // Invalid persisted rows must never become launcher content or counters.
  const alarms = input.alarms.filter((alarm) => ID_PATTERN.test(alarm.requestId)
    && typeof alarm.title === 'string'
    && (alarm.occurrenceId === null || ID_PATTERN.test(alarm.occurrenceId))
    && (alarm.scheduledAtEpochMs === null || (Number.isSafeInteger(alarm.scheduledAtEpochMs)
      && alarm.scheduledAtEpochMs >= 0 && alarm.scheduledAtEpochMs <= 8_640_000_000_000_000)));
  const candidates = alarms.filter((alarm) => isFutureScheduled(alarm, input.nowEpochMs));
  const next = [...candidates].sort(compareStable)[0] ?? null;

  const counts: WidgetSnapshotCounts = {
    pendingProposals: alarms.filter((alarm) => alarm.proposal === 'ACTIVE'
      && (alarm.decision === 'PENDING' || alarm.decision === 'NEEDS_REVIEW')).length,
    pendingActivations: alarms.filter((alarm) => alarm.proposal === 'ACTIVE'
      && alarm.decision === 'ACCEPTED'
      && PENDING_ACTIVATION_STATES.includes(alarm.scheduling)).length,
    withdrawalPending: alarms.filter((alarm) => alarm.scheduling === 'CANCEL_PENDING').length,
  };

  const visibleTasks = (input.tasks ?? []).filter(task => task.groupId === input.scope!.groupId
    && (task.status === 'pending' || task.status === 'completed') && ID_PATTERN.test(task.id) && typeof task.title === 'string'
    && task.title.trim().length > 0 && typeof task.assigneeLabel === 'string'
    && Number.isSafeInteger(task.version) && task.version > 0
    && (task.dueAtEpochMs === null || (Number.isSafeInteger(task.dueAtEpochMs)
      && task.dueAtEpochMs >= 0 && task.dueAtEpochMs <= 8_640_000_000_000_000)));
  const uniqueTasks = [...new Map(visibleTasks.map(task => [task.id, task])).values()];
  const pendingTasks = uniqueTasks.filter(task => task.status === 'pending').sort((a, b) =>
    (a.dueAtEpochMs ?? Infinity) - (b.dueAtEpochMs ?? Infinity) || a.id.localeCompare(b.id));
  const completedTasks = uniqueTasks.filter(task => task.status === 'completed').sort((a, b) =>
    (b.completedAtEpochMs ?? 0) - (a.completedAtEpochMs ?? 0) || a.id.localeCompare(b.id)).slice(0, 5);
  const tasks = [...pendingTasks, ...completedTasks].slice(0, WIDGET_TASK_LIMIT).map(task => ({
    id: task.id, title: truncateWidgetTitle(task.title), completed: task.status === 'completed', version: task.version,
    assigneeLabel: truncateWidgetTitle(task.assigneeLabel), dueAtEpochMs: task.dueAtEpochMs,
    ...(task.assignmentDecision ? { assignmentDecision: task.assignmentDecision } : {}),
  }));

  return {
    schemaVersion: WIDGET_SNAPSHOT_SCHEMA_VERSION,
    scope: { userId: input.scope.userId, groupId: input.scope.groupId },
    generatedAtEpochMs,
    nextAlarm: next === null ? null : {
      requestId: next.requestId,
      occurrenceId: next.occurrenceId,
      title: truncateWidgetTitle(next.title),
      scheduledAtEpochMs: next.scheduledAtEpochMs!,
      mode: next.mode,
    },
    counts,
    tasks,
    pendingTaskCount: pendingTasks.length,
  };
}

/** Snapshot de sesión cerrada: sin contenido privado y sin contadores que insinúen datos. */
export function createSignedOutWidgetSnapshot(nowEpochMs: number): WidgetSnapshot {
  assertEpochMs(nowEpochMs, 'nowEpochMs');
  return {
    schemaVersion: WIDGET_SNAPSHOT_SCHEMA_VERSION,
    scope: null,
    generatedAtEpochMs: nowEpochMs,
    nextAlarm: null,
    tasks: [],
    pendingTaskCount: 0,
    counts: { pendingProposals: 0, pendingActivations: 0, withdrawalPending: 0 },
  };
}

export function snapshotHasContent(snapshot: WidgetSnapshot): boolean {
  return snapshot.scope !== null;
}

/**
 * Solo publica un snapshot si pertenece a la sesión vigente. Evita que un snapshot
 * en disco del usuario anterior se pinte tras cambiar de cuenta o cerrar sesión.
 */
export function adoptSnapshotForSession(
  snapshot: WidgetSnapshot,
  session: { readonly userId: string; readonly groupId: string } | null,
  nowEpochMs: number,
): WidgetSnapshot {
  if (!isValidWidgetSnapshot(snapshot) || session === null || snapshot.scope === null) {
    return createSignedOutWidgetSnapshot(nowEpochMs);
  }
  if (snapshot.scope.userId !== session.userId || snapshot.scope.groupId !== session.groupId) {
    return createSignedOutWidgetSnapshot(nowEpochMs);
  }
  return snapshot;
}

/** A disk projection is untrusted data even when TypeScript callers declare its type. */
export function isValidWidgetSnapshot(value: unknown): value is WidgetSnapshot {
  if (value === null || typeof value !== 'object') return false;
  const snapshot = value as WidgetSnapshot;
  const validTime = (time: unknown): time is number => typeof time === 'number'
    && Number.isSafeInteger(time) && time >= 0 && time <= 8_640_000_000_000_000;
  const validId = (id: unknown): id is string => typeof id === 'string' && ID_PATTERN.test(id);
  if (snapshot.schemaVersion !== WIDGET_SNAPSHOT_SCHEMA_VERSION || !validTime(snapshot.generatedAtEpochMs)) return false;
  if (snapshot.scope !== null && (!snapshot.scope || !validId(snapshot.scope.userId) || !validId(snapshot.scope.groupId))) return false;
  if (!snapshot.counts || ![snapshot.counts.pendingProposals, snapshot.counts.pendingActivations, snapshot.counts.withdrawalPending]
    .every((count) => Number.isSafeInteger(count) && count >= 0)) return false;
  if (!Array.isArray(snapshot.tasks) || snapshot.tasks.length > WIDGET_TASK_LIMIT
    || !Number.isSafeInteger(snapshot.pendingTaskCount) || snapshot.pendingTaskCount < snapshot.tasks.filter(task => task && !task.completed).length
    || new Set(snapshot.tasks.map(task => task?.id)).size !== snapshot.tasks.length
    || !snapshot.tasks.every(task => task && validId(task.id)
      && typeof task.completed === 'boolean' && Number.isSafeInteger(task.version) && task.version > 0
      && (task.assignmentDecision === undefined || ['pending', 'accepted', 'rejected', 'not_required'].includes(task.assignmentDecision))
      && typeof task.title === 'string' && task.title.length > 0 && task.title.length <= WIDGET_TITLE_MAX_LENGTH
      && typeof task.assigneeLabel === 'string' && task.assigneeLabel.length <= WIDGET_TITLE_MAX_LENGTH
      && (task.dueAtEpochMs === null || validTime(task.dueAtEpochMs)))) return false;
  const next = snapshot.nextAlarm;
  if (next !== null && (!next || !validId(next.requestId)
    || (next.occurrenceId !== null && !validId(next.occurrenceId))
    || typeof next.title !== 'string' || !validTime(next.scheduledAtEpochMs)
    || (next.mode !== 'ALARM' && next.mode !== 'NOTIFICATION'))) return false;
  return snapshot.scope !== null || (next === null && snapshot.tasks.length === 0 && snapshot.pendingTaskCount === 0 && Object.values(snapshot.counts).every((count) => count === 0));
}

/** `true` si el snapshot supera la antigüedad permitida o su reloj es incoherente. */
export function isWidgetSnapshotStale(
  snapshot: WidgetSnapshot,
  nowEpochMs: number,
  maxAgeMs = WIDGET_SNAPSHOT_MAX_AGE_MS,
): boolean {
  assertEpochMs(nowEpochMs, 'nowEpochMs');
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) {
    throw new DomainError('INVALID_ARGUMENT', 'Ventana de frescura inválida.', { maxAgeMs });
  }
  if (!isValidWidgetSnapshot(snapshot)) return true;
  if (snapshot.scope === null) return false;
  if (snapshot.generatedAtEpochMs > nowEpochMs) return true;
  return nowEpochMs - snapshot.generatedAtEpochMs > maxAgeMs;
}

/**
 * Adaptador del scaffold: `AlarmSummary` solo distingue tres estados de
 * programación, así que la traducción es explícita y pierde matices
 * (`SCHEDULING`/`FAILED` llegan como `PENDING_PERMISSION`). P5 debe pasar
 * `WidgetAlarmInput` real cuando conecte la proyección.
 */
export function scaffoldAlarmInput(alarm: AlarmSummary): WidgetAlarmInput {
  const decision: Decision = alarm.decision === 'accepted'
    ? 'ACCEPTED'
    : alarm.decision === 'rejected'
      ? 'REJECTED'
      : alarm.decision === 'disabled'
        ? 'DISABLED'
        : 'PENDING';

  const scheduling: SchedulingStatus = alarm.scheduling === 'scheduled'
    ? 'SCHEDULED'
    : alarm.scheduling === 'pending_activation'
      ? 'PENDING_PERMISSION'
      : 'NOT_SCHEDULED';

  const parsed = alarm.scheduledAt === null ? null : Date.parse(alarm.scheduledAt);

  return {
    requestId: alarm.id,
    title: alarm.title,
    proposal: 'ACTIVE',
    decision,
    scheduling,
    occurrenceId: null,
    scheduledAtEpochMs: parsed !== null && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null,
    mode: 'ALARM',
  };
}
