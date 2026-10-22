/**
 * P6 · Modelo puro de tareas del grupo (TDD §5, `groups/{groupId}/tasks/{taskId}`).
 *
 * Reglas que este módulo hace cumplir:
 * - El responsable es un `uid` de un miembro activo, nunca un nombre libre.
 * - Completar dos veces es idempotente: no sube versión ni vuelve a invalidar alarmas.
 * - Detener, posponer o descartar una alarma **no** completa la tarea (TDD invariante 6).
 * - Completar/cancelar produce un plan de retirada de alarmas vinculadas; ejecutarlo
 *   es responsabilidad de P3 (servidor) y P5/P4 (dispositivo y runtime).
 * - Las fechas viajan como epoch ms; la zona se inyecta solo para formatear.
 */
import { DomainError } from '../../domain/errors.ts';
import type { SyncStatus } from '../../domain/states.ts';

export const TASK_TITLE_MAX_LENGTH = 120;
export const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type TaskStatus = 'pending' | 'completed' | 'cancelled';

export type HouseholdTask = {
  readonly id: string;
  readonly groupId: string;
  readonly title: string;
  /** UID del miembro activo; `null` si aún no tiene responsable. */
  readonly assigneeUid: string | null;
  readonly createdByUid: string;
  readonly activateAtEpochMs: number | null;
  readonly dueAtEpochMs: number | null;
  readonly status: TaskStatus;
  /** Versión de la entidad; cualquier cambio de estado la incrementa. */
  readonly version: number;
  readonly completedByUid: string | null;
  readonly completedAtEpochMs: number | null;
};

export type TaskMember = {
  readonly uid: string;
  readonly status: 'active' | 'removed';
};

export type TaskDraft = {
  readonly title: string;
  readonly assigneeUid: string | null;
  readonly activateAtEpochMs: number | null;
  readonly dueAtEpochMs: number | null;
};

export type TaskMutationOutcome = 'applied' | 'already_completed' | 'already_cancelled';

export type TaskMutation = {
  readonly task: HouseholdTask;
  readonly outcome: TaskMutationOutcome;
  readonly changed: boolean;
  /** Solo `true` la primera vez que la tarea pasa a un estado terminal. */
  readonly invalidatesLinkedAlarms: boolean;
};

export type TaskAlarmLink = {
  readonly requestId: string;
  readonly occurrenceId: string | null;
};

export type LinkedAlarmWithdrawalPlan = {
  readonly kind: 'withdrawLinkedAlarms';
  readonly taskId: string;
  readonly reason: 'task_completed' | 'task_cancelled';
  readonly requestIds: readonly string[];
};

function isEpochMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function assertActiveMember(members: readonly TaskMember[], uid: string, field: string): void {
  const member = members.find((candidate) => candidate.uid === uid);
  if (member === undefined || member.status !== 'active') {
    throw new DomainError('FORBIDDEN', `El usuario no es miembro activo del grupo (${field}).`, { field });
  }
}

/** Colapsa espacios y valida longitud; no devuelve un título vacío. */
export function normalizeTaskTitle(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DomainError('INVALID_ARGUMENT', 'El título de la tarea es obligatorio.');
  }
  const title = value.replace(/\s+/g, ' ').trim();
  if (title.length === 0) {
    throw new DomainError('INVALID_ARGUMENT', 'El título de la tarea no puede estar vacío.');
  }
  if (title.length > TASK_TITLE_MAX_LENGTH) {
    throw new DomainError('INVALID_ARGUMENT', `El título supera ${TASK_TITLE_MAX_LENGTH} caracteres.`);
  }
  return title;
}

/**
 * Valida un borrador antes de enviarlo a P3. No escribe nada.
 * `members` debe ser la pertenencia vigente del grupo.
 */
export function validateTaskDraft(draft: TaskDraft, members: readonly TaskMember[]): TaskDraft {
  const title = normalizeTaskTitle(draft.title);

  if (draft.assigneeUid !== null) {
    if (typeof draft.assigneeUid !== 'string' || draft.assigneeUid.length === 0) {
      throw new DomainError('INVALID_ARGUMENT', 'Responsable inválido.');
    }
    assertActiveMember(members, draft.assigneeUid, 'assigneeUid');
  }

  if (draft.activateAtEpochMs !== null && !isEpochMs(draft.activateAtEpochMs)) {
    throw new DomainError('INVALID_ARGUMENT', 'Fecha de activación inválida.');
  }
  if (draft.dueAtEpochMs !== null && !isEpochMs(draft.dueAtEpochMs)) {
    throw new DomainError('INVALID_ARGUMENT', 'Vencimiento inválido.');
  }
  if (draft.activateAtEpochMs !== null
    && draft.dueAtEpochMs !== null
    && draft.dueAtEpochMs < draft.activateAtEpochMs) {
    throw new DomainError('INVALID_ARGUMENT', 'El vencimiento no puede ser anterior a la activación.');
  }

  return {
    title,
    assigneeUid: draft.assigneeUid,
    activateAtEpochMs: draft.activateAtEpochMs,
    dueAtEpochMs: draft.dueAtEpochMs,
  };
}

/** Crea la entidad local para la UI/fake antes de que P3 responda con la versión real. */
export function createTask(input: {
  readonly id: string;
  readonly groupId: string;
  readonly createdByUid: string;
  readonly draft: TaskDraft;
  readonly members: readonly TaskMember[];
}): HouseholdTask {
  if (!TASK_ID_PATTERN.test(input.id)) {
    throw new DomainError('INVALID_ARGUMENT', 'Identificador de tarea inválido.', { id: input.id });
  }
  assertActiveMember(input.members, input.createdByUid, 'createdByUid');
  const draft = validateTaskDraft(input.draft, input.members);

  return {
    id: input.id,
    groupId: input.groupId,
    title: draft.title,
    assigneeUid: draft.assigneeUid,
    createdByUid: input.createdByUid,
    activateAtEpochMs: draft.activateAtEpochMs,
    dueAtEpochMs: draft.dueAtEpochMs,
    status: 'pending',
    version: 1,
    completedByUid: null,
    completedAtEpochMs: null,
  };
}

/**
 * Completar es idempotente por diseño: un doble toque, un reintento o dos
 * dispositivos no crean una segunda invalidación de alarmas.
 */
export function completeTask(
  task: HouseholdTask,
  input: { readonly actorUid: string; readonly members: readonly TaskMember[]; readonly nowEpochMs: number },
): TaskMutation {
  assertActiveMember(input.members, input.actorUid, 'actorUid');
  if (!isEpochMs(input.nowEpochMs)) {
    throw new DomainError('INVALID_ARGUMENT', 'Instante de finalización inválido.');
  }
  if (task.status === 'cancelled') {
    throw new DomainError('INVALID_ARGUMENT', 'Una tarea cancelada no se puede completar.');
  }
  if (task.status === 'completed') {
    return { task, outcome: 'already_completed', changed: false, invalidatesLinkedAlarms: false };
  }
  return {
    task: {
      ...task,
      status: 'completed',
      version: task.version + 1,
      completedByUid: input.actorUid,
      completedAtEpochMs: input.nowEpochMs,
    },
    outcome: 'applied',
    changed: true,
    invalidatesLinkedAlarms: true,
  };
}

export function cancelTask(
  task: HouseholdTask,
  input: { readonly actorUid: string; readonly members: readonly TaskMember[]; readonly nowEpochMs: number },
): TaskMutation {
  assertActiveMember(input.members, input.actorUid, 'actorUid');
  if (!isEpochMs(input.nowEpochMs)) {
    throw new DomainError('INVALID_ARGUMENT', 'Instante de cancelación inválido.');
  }
  if (task.status === 'completed') {
    throw new DomainError('INVALID_ARGUMENT', 'Una tarea completada no se puede cancelar.');
  }
  if (task.status === 'cancelled') {
    return { task, outcome: 'already_cancelled', changed: false, invalidatesLinkedAlarms: false };
  }
  return {
    task: { ...task, status: 'cancelled', version: task.version + 1 },
    outcome: 'applied',
    changed: true,
    invalidatesLinkedAlarms: true,
  };
}

/**
 * Interacción con una alarma vinculada. Devuelve la misma tarea: ni detener ni
 * posponer ni descartar el aviso cambia estado, versión, responsable o vencimiento.
 */
export function taskAfterAlarmInteraction(task: HouseholdTask): HouseholdTask {
  return task;
}

/** Plan que P6 entrega a P3/P5: retirar alarmas vinculadas sin escribir desde la UI. */
export function planLinkedAlarmWithdrawal(
  task: HouseholdTask,
  links: readonly TaskAlarmLink[],
): LinkedAlarmWithdrawalPlan | null {
  if (task.status === 'pending') return null;
  const requestIds = [...new Set(links.map((link) => link.requestId))].sort();
  if (requestIds.length === 0) return null;
  return {
    kind: 'withdrawLinkedAlarms',
    taskId: task.id,
    reason: task.status === 'completed' ? 'task_completed' : 'task_cancelled',
    requestIds,
  };
}

/* ------------------------------ presentación ------------------------------ */

export type TaskWriteState = {
  /** Estado de la operación en el outbox de P5. */
  readonly sync: SyncStatus;
  /** Retirada de alarmas vinculadas solicitada pero sin acuse del dispositivo. */
  readonly alarmWithdrawal: 'none' | 'pending' | 'confirmed';
};

export type TaskCardState = {
  readonly label: string;
  readonly tone: 'neutral' | 'pending' | 'error' | 'done';
  readonly detail: string | null;
};

/** Traduce los estados de sincronización a texto visible; nunca afirma éxito sin `CONFIRMED`. */
export function describeTaskCardState(task: HouseholdTask, write?: TaskWriteState): TaskCardState {
  if (write?.sync === 'CONFLICT') {
    return { label: 'Conflicto de versión', tone: 'error', detail: 'Alguien cambió la tarea. Recarga antes de repetir.' };
  }
  if (write?.sync === 'FAILED_PERMANENT') {
    return { label: 'No se pudo guardar', tone: 'error', detail: 'La operación no se reintenta sola.' };
  }
  if (write?.sync === 'QUEUED' || write?.sync === 'SENDING') {
    return { label: 'Guardando…', tone: 'pending', detail: 'Todavía no hay confirmación del servidor.' };
  }
  const label = task.status === 'completed' ? 'Completada' : task.status === 'cancelled' ? 'Cancelada' : 'Pendiente';
  if (write?.alarmWithdrawal === 'pending') {
    return { label, tone: 'pending', detail: 'Retirada de alarmas pedida, sin acuse del móvil.' };
  }
  return { label, tone: task.status === 'completed' ? 'done' : 'neutral', detail: null };
}

function localDate(epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochMs));
}

function localTime(epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epochMs));
}

/** «Vence hoy · 18:00», «Vencía el 21 · 09:00», «Sin fecha». */
export function describeTaskDue(
  task: HouseholdTask,
  nowEpochMs: number,
  timeZone: string,
): string {
  if (task.dueAtEpochMs === null) return 'Sin fecha';
  const due = localDate(task.dueAtEpochMs, timeZone);
  const today = localDate(nowEpochMs, timeZone);
  const time = localTime(task.dueAtEpochMs, timeZone);
  if (due === today) return `Vence hoy · ${time}`;
  const dueDay = Date.parse(`${due}T00:00:00Z`);
  const todayDay = Date.parse(`${today}T00:00:00Z`);
  const diff = Math.round((dueDay - todayDay) / 86_400_000);
  if (diff === 1) return `Vence mañana · ${time}`;
  if (diff < 0) return `Venció el ${due.slice(8, 10)} · ${time}`;
  return `Vence el ${due.slice(8, 10)} · ${time}`;
}

/** Inicial para avatar cuando el miembro no tiene nombre visible resuelto por P2. */
export function memberInitial(name: string | null, uid: string): string {
  const source = (name ?? uid).trim();
  return source.length === 0 ? '?' : source.charAt(0).toUpperCase();
}
