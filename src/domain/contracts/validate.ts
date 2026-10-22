/**
 * Validadores de entrada en ejecución para el contrato v1.
 *
 * Los tipos del compilador no validan lo que llega de un cliente. Estas funciones
 * comprueban forma y semántica y lanzan `DomainError('INVALID_ARGUMENT')` con la
 * ruta del campo, sin devolver nunca datos a medio validar.
 */
import { DomainError, isAppErrorCode } from '../errors.ts';
import {
  isConsentScope,
  isDecision,
  isMode,
  isScheduleMechanism,
  isScheduleReportStatus,
  PROPOSAL_STATUSES,
  RECEPTION_STATUSES,
  SCHEDULING_STATUSES,
  type Decision,
  type Mode,
  type ProposalStatus,
  type ReceptionStatus,
  type SchedulingStatus,
} from '../states.ts';
import { assertTimeSpecConsistent, isPast, isValidTimeZone, parseLocalDate, parseLocalTime } from '../time.ts';
import {
  CONTRACT_LIMITS,
  SCHEMA_VERSION,
  SYNC_ENTITY_TYPES,
  type AlarmRequestDetail,
  type AlarmRequestDocument,
  type AlarmRequestPage,
  type AppErrorPayload,
  type CreateAlarmRequest,
  type OperationReceipt,
  type RecipientDocument,
  type ReportSchedule,
  type ReportSchedulePayload,
  type RespondToAlarm,
  type RespondToAlarmPayload,
  type AuthResponse,
  type MeResponse,
  type PublicUser,
  type ScheduleDocument,
  type SessionToken,
  type SyncChange,
  type SyncEntityType,
  type SyncPage,
  type TimeSpec,
  type WeeklyRecurrence,
  type WithdrawAlarmRequest,
} from './types.ts';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_:.-]+$/;

function invalid(message: string, details?: Readonly<Record<string, unknown>>): never {
  throw new DomainError('INVALID_ARGUMENT', message, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(`${path}: se esperaba un objeto`, { path });
  return value;
}

function assertNoExtraKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) invalid(`${path}: campos no permitidos ${JSON.stringify(extra)}`, { path, extra });
}

function readIdentifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > CONTRACT_LIMITS.identifierLength
    || !IDENTIFIER_PATTERN.test(value)) {
    invalid(`${path}: identificador no válido`, { path });
  }
  return value;
}

function readString(value: unknown, path: string, options: { min?: number; max: number }): string {
  if (typeof value !== 'string') invalid(`${path}: se esperaba texto`, { path });
  const trimmed = value.trim();
  if (trimmed.length < (options.min ?? 1)) invalid(`${path}: texto vacío o demasiado corto`, { path });
  if (value.length > options.max) invalid(`${path}: máximo ${options.max} caracteres`, { path });
  return trimmed;
}

function readPositiveInt(value: unknown, path: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    invalid(`${path}: entero >= ${minimum}`, { path });
  }
  return value as number;
}

function readEpochMs(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(`${path}: instante UTC en ms inválido`, { path });
  return value as number;
}

function readTimeSpec(value: unknown, path: string): TimeSpec {
  const record = asRecord(value, path);
  assertNoExtraKeys(record, ['timeZone', 'localDate', 'localTime', 'effectiveAtEpochMs'], path);
  const timeZone = record.timeZone;
  if (!isValidTimeZone(timeZone)) invalid(`${path}.timeZone: zona IANA desconocida`, { path, timeZone });
  if (!parseLocalDate(record.localDate)) invalid(`${path}.localDate: fecha civil inválida`, { path });
  if (!parseLocalTime(record.localTime)) invalid(`${path}.localTime: hora civil inválida`, { path });
  const effectiveAtEpochMs = readEpochMs(record.effectiveAtEpochMs, `${path}.effectiveAtEpochMs`);
  const spec: TimeSpec = {
    timeZone: timeZone as string,
    localDate: record.localDate as string,
    localTime: record.localTime as string,
    effectiveAtEpochMs,
  };
  try {
    assertTimeSpecConsistent(spec);
  } catch (error) {
    if (error instanceof DomainError) {
      invalid(`${path}: el instante no corresponde a la hora civil en esa zona`, { path, ...error.details });
    }
    throw error;
  }
  return spec;
}

function readWeeklyRecurrence(value: unknown, path: string): WeeklyRecurrence {
  const record = asRecord(value, path);
  assertNoExtraKeys(record, ['kind', 'isoWeekday', 'localTime', 'untilEpochMs'], path);
  if (record.kind !== 'WEEKLY') invalid(`${path}.kind: solo se admite WEEKLY`, { path });
  const isoWeekday = readPositiveInt(record.isoWeekday, `${path}.isoWeekday`);
  if (isoWeekday > 7) invalid(`${path}.isoWeekday: entre 1 y 7`, { path });
  if (!parseLocalTime(record.localTime)) invalid(`${path}.localTime: hora civil inválida`, { path });
  const recurrence: WeeklyRecurrence = {
    kind: 'WEEKLY',
    isoWeekday: isoWeekday as WeeklyRecurrence['isoWeekday'],
    localTime: record.localTime as string,
  };
  if (record.untilEpochMs !== undefined) recurrence.untilEpochMs = readEpochMs(record.untilEpochMs, `${path}.untilEpochMs`);
  return recurrence;
}

export type EnvelopeFields = {
  schemaVersion: 1;
  operationId: string;
  groupId: string;
  entityId?: string;
  expectedRequestVersion?: number;
  expectedDecisionRevision?: number;
  payload: Record<string, unknown>;
};

const ENVELOPE_KEYS = [
  'schemaVersion',
  'operationId',
  'groupId',
  'entityId',
  'expectedRequestVersion',
  'expectedDecisionRevision',
  'payload',
] as const;

/** Valida el sobre común. Un reintento conserva `operationId` y payload. */
export function parseOperationEnvelope(data: unknown): EnvelopeFields {
  const record = asRecord(data, '$');
  assertNoExtraKeys(record, ENVELOPE_KEYS, '$');
  if (record.schemaVersion !== SCHEMA_VERSION) {
    invalid('$.schemaVersion: solo se admite la versión 1 del contrato', { received: record.schemaVersion });
  }
  const fields: EnvelopeFields = {
    schemaVersion: SCHEMA_VERSION,
    operationId: readIdentifier(record.operationId, '$.operationId'),
    groupId: readIdentifier(record.groupId, '$.groupId'),
    payload: asRecord(record.payload, '$.payload'),
  };
  if (record.entityId !== undefined) fields.entityId = readIdentifier(record.entityId, '$.entityId');
  if (record.expectedRequestVersion !== undefined) {
    fields.expectedRequestVersion = readPositiveInt(record.expectedRequestVersion, '$.expectedRequestVersion');
  }
  if (record.expectedDecisionRevision !== undefined) {
    fields.expectedDecisionRevision = readPositiveInt(record.expectedDecisionRevision, '$.expectedDecisionRevision');
  }
  return fields;
}

function requireEntityId(fields: EnvelopeFields): string {
  if (!fields.entityId) invalid('$.entityId: obligatorio para esta operación');
  return fields.entityId;
}

export type ValidationOptions = { nowEpochMs?: number };

export function parseCreateAlarmRequest(data: unknown, options: ValidationOptions = {}): CreateAlarmRequest {
  const fields = parseOperationEnvelope(data);
  const payload = fields.payload;
  assertNoExtraKeys(payload, ['title', 'note', 'taskId', 'recipientUids', 'mode', 'timeSpec', 'recurrence'], '$.payload');

  const title = readString(payload.title, '$.payload.title', { max: CONTRACT_LIMITS.titleLength });
  if (!isMode(payload.mode)) invalid('$.payload.mode: solo ALARM o NOTIFICATION', { received: payload.mode });
  const timeSpec = readTimeSpec(payload.timeSpec, '$.payload.timeSpec');

  const recipients = payload.recipientUids;
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > CONTRACT_LIMITS.maxRecipients) {
    invalid(`$.payload.recipientUids: entre 1 y ${CONTRACT_LIMITS.maxRecipients} destinatarios`);
  }
  const recipientUids = recipients.map((uid, index) => readIdentifier(uid, `$.payload.recipientUids/${index}`));
  if (new Set(recipientUids).size !== recipientUids.length) {
    invalid('$.payload.recipientUids: no puede repetirse un destinatario');
  }

  const command: CreateAlarmRequest = {
    ...fields,
    payload: {
      title,
      recipientUids,
      mode: payload.mode,
      timeSpec,
    },
  };
  if (payload.note !== undefined) {
    command.payload.note = readString(payload.note, '$.payload.note', { max: CONTRACT_LIMITS.noteLength });
  }
  if (payload.taskId !== undefined) command.payload.taskId = readIdentifier(payload.taskId, '$.payload.taskId');
  if (payload.recurrence !== undefined) {
    const recurrence = readWeeklyRecurrence(payload.recurrence, '$.payload.recurrence');
    if (recurrence.untilEpochMs !== undefined && recurrence.untilEpochMs <= timeSpec.effectiveAtEpochMs) {
      invalid('$.payload.recurrence.untilEpochMs: debe ser posterior al primer aviso');
    }
    command.payload.recurrence = recurrence;
  }
  if (options.nowEpochMs !== undefined && isPast(timeSpec.effectiveAtEpochMs, options.nowEpochMs)) {
    invalid('$.payload.timeSpec.effectiveAtEpochMs: el aviso debe programarse en el futuro', {
      nowEpochMs: options.nowEpochMs,
    });
  }
  return command;
}

export function parseRespondToAlarm(data: unknown, options: ValidationOptions = {}): RespondToAlarm {
  const fields = parseOperationEnvelope(data);
  requireEntityId(fields);
  if (fields.expectedRequestVersion === undefined || fields.expectedDecisionRevision === undefined) {
    invalid('$: respondToAlarm exige expectedRequestVersion y expectedDecisionRevision');
  }
  const payload = fields.payload;
  assertNoExtraKeys(payload, ['decision', 'chosenTimeSpec', 'consentScope', 'reason'], '$.payload');
  if (payload.decision !== 'ACCEPTED' && payload.decision !== 'REJECTED' && payload.decision !== 'DISABLED') {
    invalid('$.payload.decision: solo ACCEPTED, REJECTED o DISABLED', { received: payload.decision });
  }

  const response: RespondToAlarmPayload = { decision: payload.decision };
  if (payload.decision === 'ACCEPTED') {
    if (!isConsentScope(payload.consentScope)) {
      invalid('$.payload.consentScope: aceptar exige THIS_OCCURRENCE o SERIES');
    }
    response.consentScope = payload.consentScope;
    if (payload.chosenTimeSpec !== undefined) {
      const chosenTimeSpec = readTimeSpec(payload.chosenTimeSpec, '$.payload.chosenTimeSpec');
      if (options.nowEpochMs !== undefined && isPast(chosenTimeSpec.effectiveAtEpochMs, options.nowEpochMs)) {
        invalid('$.payload.chosenTimeSpec.effectiveAtEpochMs: la hora elegida ya pasó');
      }
      response.chosenTimeSpec = chosenTimeSpec;
    }
  } else {
    if (payload.chosenTimeSpec !== undefined) {
      invalid('$.payload.chosenTimeSpec: solo se admite al aceptar');
    }
    if (payload.consentScope !== undefined) {
      invalid('$.payload.consentScope: solo acompaña a ACCEPTED');
    }
  }
  if (payload.reason !== undefined) {
    response.reason = readString(payload.reason, '$.payload.reason', { max: CONTRACT_LIMITS.reasonLength });
  }
  return { ...fields, payload: response };
}

export function parseReportSchedule(data: unknown): ReportSchedule {
  const fields = parseOperationEnvelope(data);
  requireEntityId(fields);
  const payload = fields.payload;
  assertNoExtraKeys(payload, [
    'occurrenceId',
    'deviceId',
    'deviceEpoch',
    'requestVersion',
    'decisionRevision',
    'mode',
    'mechanism',
    'status',
    'effectiveAtEpochMs',
    'reportedAtEpochMs',
    'reason',
  ], '$.payload');

  if (!isMode(payload.mode)) invalid('$.payload.mode: solo ALARM o NOTIFICATION', { received: payload.mode });
  if (!isScheduleMechanism(payload.mechanism)) {
    invalid('$.payload.mechanism: solo ALARM_RUNTIME o EXPO_NOTIFICATIONS', { received: payload.mechanism });
  }
  if (payload.mode === 'ALARM' && payload.mechanism !== 'ALARM_RUNTIME') {
    invalid('$.payload.mechanism: una alarma audible solo se programa con ALARM_RUNTIME');
  }
  if (payload.mode === 'NOTIFICATION' && payload.mechanism !== 'EXPO_NOTIFICATIONS') {
    invalid('$.payload.mechanism: un recordatorio estándar solo se programa con EXPO_NOTIFICATIONS');
  }
  if (!isScheduleReportStatus(payload.status)) {
    invalid('$.payload.status: estado de acuse no permitido', { received: payload.status });
  }
  const report: ReportSchedulePayload = {
    occurrenceId: readIdentifier(payload.occurrenceId, '$.payload.occurrenceId'),
    deviceId: readIdentifier(payload.deviceId, '$.payload.deviceId'),
    deviceEpoch: readPositiveInt(payload.deviceEpoch, '$.payload.deviceEpoch'),
    requestVersion: readPositiveInt(payload.requestVersion, '$.payload.requestVersion'),
    decisionRevision: readPositiveInt(payload.decisionRevision, '$.payload.decisionRevision'),
    mode: payload.mode,
    mechanism: payload.mechanism,
    status: payload.status,
    effectiveAtEpochMs: readEpochMs(payload.effectiveAtEpochMs, '$.payload.effectiveAtEpochMs'),
    reportedAtEpochMs: readEpochMs(payload.reportedAtEpochMs, '$.payload.reportedAtEpochMs'),
  };
  if (payload.status === 'FAILED' || payload.status === 'PENDING_PERMISSION') {
    if (payload.reason === undefined) invalid('$.payload.reason: obligatorio al fallar o quedar pendiente de permiso');
  }
  if (payload.reason !== undefined) {
    report.reason = readString(payload.reason, '$.payload.reason', { max: CONTRACT_LIMITS.reasonLength });
  }
  return { ...fields, payload: report };
}

export function parseWithdrawAlarmRequest(data: unknown): WithdrawAlarmRequest {
  const fields = parseOperationEnvelope(data);
  requireEntityId(fields);
  if (fields.expectedRequestVersion === undefined) {
    invalid('$: withdrawAlarmRequest exige expectedRequestVersion');
  }
  assertNoExtraKeys(fields.payload, ['reason'], '$.payload');
  const reason = readString(fields.payload.reason, '$.payload.reason', { max: CONTRACT_LIMITS.reasonLength });
  return { ...fields, payload: { reason } };
}

export function parseOperationReceipt(data: unknown): OperationReceipt {
  const record = asRecord(data, '$');
  assertNoExtraKeys(record, [
    'operationId',
    'status',
    'serverTimeEpochMs',
    'requestVersion',
    'decisionRevision',
    'result',
  ], '$');
  if (record.status !== 'APPLIED' && record.status !== 'REPLAYED') {
    invalid('$.status: solo APPLIED o REPLAYED', { received: record.status });
  }
  const receipt: OperationReceipt = {
    operationId: readIdentifier(record.operationId, '$.operationId'),
    status: record.status,
    serverTimeEpochMs: readEpochMs(record.serverTimeEpochMs, '$.serverTimeEpochMs'),
  };
  if (record.requestVersion !== undefined) {
    receipt.requestVersion = readPositiveInt(record.requestVersion, '$.requestVersion');
  }
  if (record.decisionRevision !== undefined) {
    receipt.decisionRevision = readPositiveInt(record.decisionRevision, '$.decisionRevision');
  }
  if (record.result !== undefined) receipt.result = asRecord(record.result, '$.result');
  return receipt;
}

export function parseAppError(data: unknown): AppErrorPayload {
  const record = asRecord(data, '$');
  assertNoExtraKeys(record, ['code', 'message', 'retryable', 'serverTimeEpochMs', 'details'], '$');
  if (!isAppErrorCode(record.code)) invalid('$.code: código de error desconocido', { received: record.code });
  const error: AppErrorPayload = {
    code: record.code,
    message: readString(record.message, '$.message', { max: 300 }),
  };
  if (record.retryable !== undefined) {
    if (typeof record.retryable !== 'boolean') invalid('$.retryable: se esperaba booleano');
    error.retryable = record.retryable;
  }
  if (record.serverTimeEpochMs !== undefined) {
    error.serverTimeEpochMs = readEpochMs(record.serverTimeEpochMs, '$.serverTimeEpochMs');
  }
  if (record.details !== undefined) error.details = asRecord(record.details, '$.details');
  return error;
}

export function parseAlarmRequestDocument(data: unknown): AlarmRequestDocument {
  const record = asRecord(data, '$');
  assertNoExtraKeys(record, [
    'creatorUid',
    'title',
    'note',
    'taskId',
    'recipientUids',
    'requestVersion',
    'status',
    'timeSpec',
    'mode',
    'recurrence',
    'createdAtEpochMs',
    'updatedAtEpochMs',
    'withdrawnAtEpochMs',
    'expiredAtEpochMs',
  ], '$');
  const status = record.status;
  if (typeof status !== 'string' || !(PROPOSAL_STATUSES as readonly string[]).includes(status)) {
    invalid('$.status: estado de propuesta desconocido', { received: status });
  }
  if (!isMode(record.mode)) invalid('$.mode: solo ALARM o NOTIFICATION', { received: record.mode });
  const recipients = record.recipientUids;
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > CONTRACT_LIMITS.maxRecipients) {
    invalid(`$.recipientUids: entre 1 y ${CONTRACT_LIMITS.maxRecipients} destinatarios`);
  }

  const document: AlarmRequestDocument = {
    creatorUid: readIdentifier(record.creatorUid, '$.creatorUid'),
    title: readString(record.title, '$.title', { max: CONTRACT_LIMITS.titleLength }),
    recipientUids: recipients.map((uid, index) => readIdentifier(uid, `$.recipientUids/${index}`)),
    requestVersion: readPositiveInt(record.requestVersion, '$.requestVersion'),
    status: status as ProposalStatus,
    timeSpec: readTimeSpec(record.timeSpec, '$.timeSpec'),
    mode: record.mode,
    createdAtEpochMs: readEpochMs(record.createdAtEpochMs, '$.createdAtEpochMs'),
    updatedAtEpochMs: readEpochMs(record.updatedAtEpochMs, '$.updatedAtEpochMs'),
  };
  if (record.note !== undefined) {
    document.note = readString(record.note, '$.note', { max: CONTRACT_LIMITS.noteLength });
  }
  if (record.taskId !== undefined) document.taskId = readIdentifier(record.taskId, '$.taskId');
  if (record.recurrence !== undefined) document.recurrence = readWeeklyRecurrence(record.recurrence, '$.recurrence');
  if (record.withdrawnAtEpochMs !== undefined) {
    document.withdrawnAtEpochMs = readEpochMs(record.withdrawnAtEpochMs, '$.withdrawnAtEpochMs');
  }
  if (record.expiredAtEpochMs !== undefined) {
    document.expiredAtEpochMs = readEpochMs(record.expiredAtEpochMs, '$.expiredAtEpochMs');
  }
  return document;
}

export function parseRecipientDocument(data: unknown): RecipientDocument {
  const record = asRecord(data, '$');
  assertNoExtraKeys(record, [
    'uid',
    'receivedVersion',
    'reception',
    'decision',
    'decisionRevision',
    'acceptedRequestVersion',
    'chosenTimeSpec',
    'consentScope',
    'reason',
    'updatedAtEpochMs',
  ], '$');
  const reception = record.reception;
  if (typeof reception !== 'string' || !(RECEPTION_STATUSES as readonly string[]).includes(reception)) {
    invalid('$.reception: estado de recepción desconocido', { received: reception });
  }
  if (!isDecision(record.decision)) invalid('$.decision: decisión desconocida', { received: record.decision });
  const document: RecipientDocument = {
    uid: readIdentifier(record.uid, '$.uid'),
    receivedVersion: readPositiveInt(record.receivedVersion, '$.receivedVersion'),
    reception: reception as ReceptionStatus,
    decision: record.decision as Decision,
    decisionRevision: readPositiveInt(record.decisionRevision, '$.decisionRevision'),
    updatedAtEpochMs: readEpochMs(record.updatedAtEpochMs, '$.updatedAtEpochMs'),
  };
  if (record.acceptedRequestVersion !== undefined) {
    document.acceptedRequestVersion = readPositiveInt(record.acceptedRequestVersion, '$.acceptedRequestVersion');
  }
  if (record.chosenTimeSpec !== undefined) {
    document.chosenTimeSpec = readTimeSpec(record.chosenTimeSpec, '$.chosenTimeSpec');
  }
  if (record.consentScope !== undefined) {
    if (!isConsentScope(record.consentScope)) invalid('$.consentScope: valor desconocido', { received: record.consentScope });
    document.consentScope = record.consentScope;
  }
  if (record.reason !== undefined) {
    document.reason = readString(record.reason, '$.reason', { max: CONTRACT_LIMITS.reasonLength });
  }
  if (document.decision === 'ACCEPTED' && document.acceptedRequestVersion === undefined) {
    invalid('$: una decisión ACCEPTED conserva la versión de propuesta aceptada');
  }
  return document;
}

export function parseScheduleDocument(data: unknown): ScheduleDocument {
  const record = asRecord(data, '$');
  assertNoExtraKeys(record, [
    'occurrenceId',
    'deviceId',
    'deviceEpoch',
    'requestVersion',
    'decisionRevision',
    'mode',
    'mechanism',
    'status',
    'effectiveAtEpochMs',
    'reportedAtEpochMs',
    'statusUpdatedAtEpochMs',
    'reason',
  ], '$');
  if (!isMode(record.mode)) invalid('$.mode: solo ALARM o NOTIFICATION', { received: record.mode });
  if (!isScheduleMechanism(record.mechanism)) invalid('$.mechanism: valor desconocido', { received: record.mechanism });
  if (typeof record.status !== 'string' || !(SCHEDULING_STATUSES as readonly string[]).includes(record.status)) {
    invalid('$.status: estado de programación desconocido', { received: record.status });
  }
  const document: ScheduleDocument = {
    occurrenceId: readIdentifier(record.occurrenceId, '$.occurrenceId'),
    deviceId: readIdentifier(record.deviceId, '$.deviceId'),
    deviceEpoch: readPositiveInt(record.deviceEpoch, '$.deviceEpoch'),
    requestVersion: readPositiveInt(record.requestVersion, '$.requestVersion'),
    decisionRevision: readPositiveInt(record.decisionRevision, '$.decisionRevision'),
    mode: record.mode,
    mechanism: record.mechanism,
    status: record.status as SchedulingStatus,
    effectiveAtEpochMs: readEpochMs(record.effectiveAtEpochMs, '$.effectiveAtEpochMs'),
    reportedAtEpochMs: readEpochMs(record.reportedAtEpochMs, '$.reportedAtEpochMs'),
    statusUpdatedAtEpochMs: readEpochMs(record.statusUpdatedAtEpochMs, '$.statusUpdatedAtEpochMs'),
  };
  if (record.reason !== undefined) {
    document.reason = readString(record.reason, '$.reason', { max: CONTRACT_LIMITS.reasonLength });
  }
  return document;
}

/** Mapa de operación a validador, útil para callables y tests de contrato. */
export const OPERATION_PARSERS = {
  createAlarmRequest: parseCreateAlarmRequest,
  respondToAlarm: parseRespondToAlarm,
  reportSchedule: parseReportSchedule,
  withdrawAlarmRequest: parseWithdrawAlarmRequest,
} as const;

export type OperationName = keyof typeof OPERATION_PARSERS;

export function parseOperation(name: OperationName, data: unknown, options: ValidationOptions = {}):
  | CreateAlarmRequest
  | RespondToAlarm
  | ReportSchedule
  | WithdrawAlarmRequest {
  switch (name) {
    case 'createAlarmRequest':
      return parseCreateAlarmRequest(data, options);
    case 'respondToAlarm':
      return parseRespondToAlarm(data, options);
    case 'reportSchedule':
      return parseReportSchedule(data);
    case 'withdrawAlarmRequest':
      return parseWithdrawAlarmRequest(data);
  }
}

/* ------------------------------------------------------------------ *
 * Transporte HTTPS: sesión, feed y wrappers de consulta                *
 * ------------------------------------------------------------------ */

function readEmail(value: unknown, path: string): string {
  const email = readString(value, path, { max: 254 }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) invalid(`${path}: correo no válido`, { path });
  return email;
}

/** El token no se recorta ni se normaliza: es un secreto opaco. */
function readSessionToken(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 256 || /\s/.test(value)) {
    invalid(`${path}: token de sesión no válido`, { path });
  }
  return value;
}

function readCursor(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalid(`${path}: cursor opaco o null`, { path });
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 512) invalid(`${path}: cursor fuera de rango`, { path });
  return trimmed;
}

export function parsePublicUser(data: unknown): PublicUser {
  const record = asRecord(data, '$');
  assertNoExtraKeys(record, ['uid', 'email', 'displayName'], '$');
  const user: PublicUser = {
    uid: readIdentifier(record.uid, '$.uid'),
    email: readEmail(record.email, '$.email'),
  };
  if (record.displayName !== undefined) {
    user.displayName = readString(record.displayName, '$.displayName', { max: 60 });
  }
  return user;
}

export function parseSessionToken(data: unknown): SessionToken {
  const record = asRecord(data, '$');
  assertNoExtraKeys(record, ['token', 'expiresAtEpochMs'], '$');
  return {
    token: readSessionToken(record.token, '$.token'),
    expiresAtEpochMs: readEpochMs(record.expiresAtEpochMs, '$.expiresAtEpochMs'),
  };
}

/** `POST /v1/auth/register` y `/login`. El token se guarda en SecureStore, no en SQLite. */
export function parseAuthResponse(data: unknown): AuthResponse {
  const record = asRecord(data, '$');
  assertNoExtraKeys(record, ['session', 'user'], '$');
  return {
    session: parseSessionToken(record.session),
    user: parsePublicUser(record.user),
  };
}

export function parseMeResponse(data: unknown): MeResponse {
  const record = asRecord(data, '$');
  assertNoExtraKeys(record, ['user'], '$');
  return { user: parsePublicUser(record.user) };
}

function readSyncEntityType(value: unknown, path: string): SyncEntityType {
  if (typeof value !== 'string' || !(SYNC_ENTITY_TYPES as readonly string[]).includes(value)) {
    invalid(`${path}: tipo de entidad desconocido`, { path, received: value });
  }
  return value as SyncEntityType;
}

export function parseSyncChange(data: unknown, path = '$'): SyncChange {
  const record = asRecord(data, path);
  assertNoExtraKeys(record, ['sequence', 'entityType', 'entityId', 'kind', 'version', 'updatedAtEpochMs'], path);
  if (record.kind !== 'UPSERT' && record.kind !== 'DELETE') {
    invalid(`${path}.kind: solo UPSERT o DELETE`, { path });
  }
  return {
    sequence: readPositiveInt(record.sequence, `${path}.sequence`),
    entityType: readSyncEntityType(record.entityType, `${path}.entityType`),
    entityId: readIdentifier(record.entityId, `${path}.entityId`),
    kind: record.kind,
    version: readPositiveInt(record.version, `${path}.version`),
    updatedAtEpochMs: readEpochMs(record.updatedAtEpochMs, `${path}.updatedAtEpochMs`),
  };
}

/** `GET /v1/sync?cursor=`: página autorizada y siguiente cursor opaco. */
export function parseSyncPage(data: unknown): SyncPage {
  const record = asRecord(data, '$');
  assertNoExtraKeys(record, ['changes', 'nextCursor'], '$');
  if (!Array.isArray(record.changes) || record.changes.length > 200) {
    invalid('$.changes: array de como máximo 200 cambios');
  }
  return {
    changes: record.changes.map((change, index) => parseSyncChange(change, `$.changes/${index}`)),
    nextCursor: readCursor(record.nextCursor, '$.nextCursor'),
  };
}

/** `GET /v1/groups/{groupId}/alarm-requests`: wrapper de paginación. */
export function parseAlarmRequestPage(data: unknown): AlarmRequestPage {
  const record = asRecord(data, '$');
  assertNoExtraKeys(record, ['items', 'nextCursor'], '$');
  if (!Array.isArray(record.items) || record.items.length > 100) {
    invalid('$.items: array de como máximo 100 propuestas');
  }
  return {
    items: record.items.map((item, index) => {
      const entry = asRecord(item, `$.items/${index}`);
      assertNoExtraKeys(entry, ['request', 'recipient'], `$.items/${index}`);
      return {
        request: parseAlarmRequestDocument(entry.request),
        recipient: parseRecipientDocument(entry.recipient),
      };
    }),
    nextCursor: readCursor(record.nextCursor, '$.nextCursor'),
  };
}

/** `GET /v1/groups/{groupId}/alarm-requests/{requestId}`: detalle del actor. */
export function parseAlarmRequestDetail(data: unknown): AlarmRequestDetail {
  const record = asRecord(data, '$');
  assertNoExtraKeys(record, ['request', 'recipient', 'schedules'], '$');
  if (!Array.isArray(record.schedules) || record.schedules.length > 100) {
    invalid('$.schedules: array de como máximo 100 acuses');
  }
  return {
    request: parseAlarmRequestDocument(record.request),
    recipient: parseRecipientDocument(record.recipient),
    schedules: record.schedules.map((schedule) => parseScheduleDocument(schedule)),
  };
}
