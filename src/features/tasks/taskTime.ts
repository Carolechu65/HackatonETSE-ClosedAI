import type { Task, TaskPriority } from '../skeleton/model.ts';

/** Minutos de antelación del aviso según la prioridad de la tarea. */
export const PRIORITY_LEAD_MINUTES: Record<TaskPriority, number> = {
  low: 0,
  normal: 5,
  high: 10,
};

const WEEKDAY_INDEX: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
};

function atDay(now: Date, dayOffset: number, hour: number, minute = 0): Date {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  date.setDate(date.getDate() + dayOffset);
  return date;
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

/**
 * Convierte lo que escribe el usuario (`21:00`, `mañana`, `lunes`, `hoy`) en una
 * fecha límite futura. Devuelve `null` si no se reconoce; la UI no inventa una hora.
 */
export function resolveDueAt(input: string, now: Date = new Date()): Date | null {
  const text = input.trim().toLowerCase();
  if (text.length === 0) return null;

  const clock = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (clock) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    if (hours > 23 || minutes > 59) return null;
    const candidate = atDay(now, 0, hours, minutes);
    if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1);
    return candidate;
  }

  if (text === 'mañana' || text === 'manana') return atDay(now, 1, 9);

  if (text === 'hoy') {
    const candidate = atDay(now, 0, 18);
    return candidate.getTime() > now.getTime()
      ? candidate
      : new Date(now.getTime() + 30 * 60_000);
  }

  const weekday = WEEKDAY_INDEX[text];
  if (weekday !== undefined) {
    const candidate = atDay(now, 0, 9);
    const delta = (weekday - candidate.getDay() + 7) % 7;
    candidate.setDate(candidate.getDate() + delta);
    if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 7);
    return candidate;
  }

  return null;
}

/**
 * Momento del aviso: la alarma suena antes en tareas de prioridad alta.
 * Si el margen ya pasó, se avisa a la hora límite o, en el peor caso, en 30 s.
 */
export function reminderAt(dueAt: Date, priority: TaskPriority, now: Date = new Date()): Date {
  const leadMs = PRIORITY_LEAD_MINUTES[priority] * 60_000;
  const withLead = new Date(dueAt.getTime() - leadMs);
  if (withLead.getTime() > now.getTime() + 5_000) return withLead;
  if (dueAt.getTime() > now.getTime() + 5_000) return dueAt;
  return new Date(now.getTime() + 30_000);
}

export function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatReminderLabel(date: Date, now: Date = new Date()): string {
  const clock = formatClock(date);
  if (sameDay(date, now)) return `hoy ${clock}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(date, tomorrow)) return `mañana ${clock}`;
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')} ${clock}`;
}

export function priorityLabel(priority: TaskPriority): string {
  if (priority === 'high') return 'Alta';
  if (priority === 'low') return 'Baja';
  return 'Normal';
}

export function priorityLeadLabel(priority: TaskPriority): string {
  const minutes = PRIORITY_LEAD_MINUTES[priority];
  return minutes === 0 ? 'a la hora' : `${minutes} min antes`;
}

export function alarmChipLabel(task: Task): string {
  switch (task.alarmStatus) {
    case 'scheduling':
      return 'Programando';
    case 'scheduled':
      return task.alarmMode === 'NOTIFICATION' ? 'Silenciosa' : 'Programada';
    case 'pending_permission':
      return 'Permiso';
    case 'failed':
      return 'Reintentar';
    case 'fired':
      return 'Detener';
    default:
      return 'Aviso';
  }
}

export function alarmDetail(task: Task): string {
  if (task.alarmStatus === 'scheduled' && task.dueAt) {
    const dueAt = new Date(task.dueAt);
    if (!Number.isNaN(dueAt.getTime())) {
      const reminder = reminderAt(dueAt, task.priority);
      const kind = task.alarmMode === 'NOTIFICATION' ? 'Aviso silencioso' : 'Alarma';
      return `${kind} ${formatReminderLabel(reminder)}`;
    }
  }
  if (task.alarmStatus === 'pending_permission') {
    return 'Falta permiso de alarmas exactas o notificaciones.';
  }
  if (task.alarmStatus === 'failed') {
    return task.alarmReason ?? 'No se pudo programar el aviso.';
  }
  if (task.alarmStatus === 'fired') return 'Sonando ahora.';
  if (task.alarmStatus === 'scheduling') return 'Guardando la programación real…';
  return 'Sin aviso programado.';
}

export function taskMetaLabel(task: Task): string {
  return `${task.time} · ${priorityLabel(task.priority)}`;
}
