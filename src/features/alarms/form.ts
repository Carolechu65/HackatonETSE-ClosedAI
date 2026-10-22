import type { CreateAlarmRequestPayload, RespondToAlarmPayload, WeeklyRecurrence } from '../../domain/contracts/types.ts';
import { parseCreateAlarmRequest, parseRespondToAlarm } from '../../domain/contracts/validate.ts';
import { createTimeSpec, isoWeekdayOf, parseLocalDate } from '../../domain/time.ts';
import { createIdGenerator } from '../../domain/ids.ts';
import type { Mode, ConsentScope } from '../../domain/states.ts';

export type AlarmForm = {
  title: string; note: string; recipientUids: string[]; localDate: string; localTime: string;
  timeZone: string; mode: Mode; weekly: boolean; taskId: string; untilEpochMs?: number;
};
export function alarmPayload(form: AlarmForm, context: {
  groupId: string; memberIds: readonly string[]; openTaskIds: readonly string[]; nowEpochMs: number;
}): CreateAlarmRequestPayload {
  if (!form.title.trim()) throw new Error('Escribe un título para el aviso.');
  if (!form.recipientUids.length) throw new Error('Elige al menos una persona.');
  if (form.recipientUids.some(id => !context.memberIds.includes(id))) throw new Error('Una persona ya no pertenece a este piso. Revisa los destinatarios.');
  if (form.taskId && !context.openTaskIds.includes(form.taskId)) throw new Error('La tarea ya no está pendiente. Elige otra tarea o un aviso independiente.');
  const timeSpec = createTimeSpec({ timeZone: form.timeZone.trim(), localDate: form.localDate.trim(), localTime: form.localTime.trim() });
  if (timeSpec.effectiveAtEpochMs <= context.nowEpochMs) throw new Error('Elige una fecha y una hora futuras.');
  const recurrence: WeeklyRecurrence | undefined = form.weekly ? {
    kind: 'WEEKLY', isoWeekday: isoWeekdayOf(parseLocalDate(timeSpec.localDate)!) as WeeklyRecurrence['isoWeekday'], localTime: timeSpec.localTime,
    ...(form.untilEpochMs !== undefined ? { untilEpochMs: form.untilEpochMs } : {}),
  } : undefined;
  return parseCreateAlarmRequest({ schemaVersion: 1, operationId: 'form-validation', groupId: context.groupId, payload: {
    title: form.title.trim(), ...(form.note.trim() ? { note: form.note.trim() } : {}), recipientUids: [...form.recipientUids].sort(),
    mode: form.mode, timeSpec, ...(recurrence ? { recurrence } : {}), ...(form.taskId ? { taskId: form.taskId } : {}),
  } }, { nowEpochMs: context.nowEpochMs }).payload;
}

/** Same logical attempt keeps its operationId across failures; changed content gets a new one. */
export function createSubmissionIds(next: () => string = () => createIdGenerator().next()) {
  const ids = new Map<string, string>();
  return (scope: string, payload: unknown): string => {
    const key = JSON.stringify([scope, payload]);
    let id = ids.get(key);
    if (!id) { id = next(); ids.set(key, id); }
    return id;
  };
}

export function responsePayload(input: {
  groupId: string; requestId: string; requestVersion: number; decisionRevision: number;
  decision: RespondToAlarmPayload['decision']; consentScope: ConsentScope;
  chosen?: { localDate: string; localTime: string; timeZone: string }; nowEpochMs: number;
}): RespondToAlarmPayload {
  return parseRespondToAlarm({ schemaVersion: 1, operationId: 'response-validation', groupId: input.groupId,
    entityId: input.requestId, expectedRequestVersion: input.requestVersion, expectedDecisionRevision: input.decisionRevision,
    payload: { decision: input.decision, ...(input.decision === 'ACCEPTED' ? {
      consentScope: input.consentScope, ...(input.chosen ? { chosenTimeSpec: createTimeSpec(input.chosen) } : {}),
    } : {}) },
  }, { nowEpochMs: input.nowEpochMs }).payload;
}
