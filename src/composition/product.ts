import type { FinanceClient } from '../features/expenses/client.ts';
import type { CalendarClient } from '../features/calendar/client.ts';
import type { AlarmRequestDocument, RecipientDocument, ScheduleDocument, CreateAlarmRequestPayload, RespondToAlarmPayload } from '../domain/contracts/types.ts';
import type { HouseholdTask, TaskDraft } from '../features/tasks/model.ts';
import type { SchedulingStatus, SyncStatus } from '../domain/states.ts';

/** Presentation ports: screens never read SQL, credentials or the native scheduler. */
export type Group = { id: string; name: string; timeZone: string; role: string };
export type Member = { userId: string; displayName: string; role: string };
export type ProductAlarm = {
  groupId: string;
  requestId: string;
  request: AlarmRequestDocument;
  recipients: RecipientDocument[];
  schedules: ScheduleDocument[];
  /** Schedule documents have no uid: preserve their recipient envelope. */
  schedulesByRecipient?: Record<string, ScheduleDocument[]>;
  localStatus?: SchedulingStatus;
  localEffectiveAtEpochMs?: number;
  sync?: SyncStatus;
};
export type AssistantReply = {
  kind: 'needs_clarification' | 'draft';
  message: string;
  conversationId?: string;
  draft?: CreateAlarmRequestPayload;
};
export type ProductState = {
  ready: boolean;
  cleanupPending?: boolean;
  session: { userId: string; displayName: string; mode: 'demo' | 'live' } | null;
  groups: Group[];
  groupId: string | null;
  members: Member[];
  alarms: ProductAlarm[];
  tasks: HouseholdTask[];
  lastSync: number | null;
  syncing: boolean;
  pending: number;
  error: string | null;
};
export interface ProductClient {
  calendar: CalendarClient;
  finance: FinanceClient;
  getSnapshot(): ProductState;
  subscribe(listener: () => void): () => void;
  initialize(): Promise<void>;
  signIn(input: { email: string; password: string; displayName?: string }, register: boolean): Promise<void>;
  startDemo(): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
  selectGroup(id: string): Promise<void>;
  createGroup(name: string, timeZone: string): Promise<void>;
  createInvitation(): Promise<string>;
  joinGroup(token: string): Promise<void>;
  createAlarm(payload: CreateAlarmRequestPayload, operationId: string): Promise<string | null>;
  respond(alarm: ProductAlarm, payload: RespondToAlarmPayload, operationId: string): Promise<void>;
  withdraw(alarm: ProductAlarm, operationId: string): Promise<void>;
  createTask(draft: TaskDraft, operationId: string): Promise<string>;
  updateTask(task: HouseholdTask, status: 'pending' | 'completed' | 'cancelled', operationId: string): Promise<void>;
  askAssistant(text: string, conversationId?: string): Promise<AssistantReply>;
  makePrimaryDevice(): Promise<string>;
  requestPermissions(): Promise<string>;
}

export const initialProductState: ProductState = {
  ready: false, session: null, groups: [], groupId: null, members: [], alarms: [], tasks: [],
  lastSync: null, syncing: false, pending: 0, error: null,
};

export function currentRecipient(alarm: ProductAlarm, userId: string) {
  return alarm.recipients.find(recipient => recipient.uid === userId);
}

function recipientExecution(alarm: ProductAlarm, recipient: RecipientDocument, viewerUid: string) {
  if (recipient.uid === viewerUid && alarm.localStatus) return alarm.localStatus;
  const schedules = alarm.schedulesByRecipient?.[recipient.uid]
    ?? (recipient.uid === viewerUid ? alarm.schedules : []);
  return schedules.filter(schedule => schedule.requestVersion === alarm.request.requestVersion
    && schedule.decisionRevision === recipient.decisionRevision && schedule.mode === alarm.request.mode)
    .sort((a, b) => b.deviceEpoch - a.deviceEpoch || b.statusUpdatedAtEpochMs - a.statusUpdatedAtEpochMs)[0]?.status;
}

export function recipientAlarmStatus(alarm: ProductAlarm, recipient: RecipientDocument, viewerUid: string) {
  const decision = { PENDING: 'Por responder', ACCEPTED: 'Aceptada', REJECTED: 'Rechazada', DISABLED: 'Desactivada', NEEDS_REVIEW: 'Necesita revisión' }[recipient.decision];
  const reception = recipient.reception === 'RECEIVED' && recipient.receivedVersion === alarm.request.requestVersion
    ? 'Recibida' : 'Recepción sin confirmar';
  const status = recipientExecution(alarm, recipient, viewerUid);
  const execution = status ? {
    NOT_SCHEDULED: 'Sin programación confirmada', SCHEDULING: 'Activación en curso', SCHEDULED: 'Programada en el móvil',
    PENDING_PERMISSION: 'Falta un permiso', FAILED: 'No se pudo activar', CANCEL_PENDING: 'Cancelación pendiente',
    CANCELLED: 'Cancelada en el móvil', FIRED: 'El móvil registró el aviso', EXPIRED: 'Ocurrencia vencida',
  }[status] : 'Sin programación confirmada';
  return { decision, reception, execution };
}

export function alarmStatus(alarm: ProductAlarm, userId: string): { title: string; detail: string } {
  if (alarm.sync === 'CONFLICT') return { title: 'Necesita revisión', detail: 'La propuesta ha cambiado. Revisa la versión actual antes de responder.' };
  if (alarm.sync === 'QUEUED' || alarm.sync === 'SENDING') return { title: 'Pendiente de sincronizar', detail: 'Tu decisión está guardada en este dispositivo. Aún no está confirmada.' };
  if (alarm.request.status === 'WITHDRAWN') return { title: 'Propuesta retirada', detail: 'La cancelación se aplica en cada móvil cuando recibe el cambio.' };
  const recipient = currentRecipient(alarm, userId);
  const execution = recipient ? recipientExecution(alarm, recipient, userId) : undefined;
  const time = execution === 'SCHEDULED' && alarm.localEffectiveAtEpochMs !== undefined
    ? alarm.localEffectiveAtEpochMs : (recipient?.chosenTimeSpec ?? alarm.request.timeSpec).effectiveAtEpochMs;
  if (alarm.request.status === 'EXPIRED' || (!alarm.request.recurrence && time <= Date.now() && execution !== 'FIRED')) return { title: 'Hora vencida', detail: 'No se activará un aviso antiguo. Puedes proponer otra hora.' };
  if (!recipient) return { title: 'Propuesta enviada', detail: 'Cada destinatario decide si activa su aviso.' };
  if (recipient.decision === 'REJECTED') return { title: 'Rechazada', detail: 'Este aviso no se activa. La tarea asociada se conserva.' };
  if (recipient.decision === 'DISABLED') return { title: 'Aviso desactivado', detail: 'La decisión de desactivar se conserva aunque estés sin conexión.' };
  if (recipient.decision === 'NEEDS_REVIEW') return { title: 'Necesita revisión', detail: 'Hay una nueva versión. Debes volver a decidir.' };
  if (recipient.decision !== 'ACCEPTED') return { title: 'Por responder', detail: 'Tú decides si te viene bien, prefieres otra hora o lo rechazas.' };
  const status = execution;
  if (status === 'SCHEDULED') return { title: 'Programada en el móvil', detail: 'El dispositivo confirmó la programación de esta versión.' };
  if (status === 'PENDING_PERMISSION') return { title: 'Falta un permiso', detail: 'Has aceptado. Revisa los permisos para activar el aviso.' };
  if (status === 'CANCEL_PENDING') return { title: 'Cancelación pendiente', detail: 'Todavía no se ha confirmado la retirada en el dispositivo.' };
  if (status === 'FAILED') return { title: 'No se pudo activar', detail: 'Tu aceptación se conserva. Revisa los permisos y vuelve a sincronizar.' };
  if (status === 'FIRED') return { title: 'Aviso registrado por el móvil', detail: 'El dispositivo informó de la ejecución. Esto no confirma que lo hayas oído.' };
  if (status === 'CANCELLED') return { title: 'Cancelada en el móvil', detail: 'El dispositivo confirmó la retirada de esta ocurrencia.' };
  return { title: 'Aceptada · por activar', detail: 'Tu aceptación está guardada. El móvil aún no ha confirmado la programación.' };
}
