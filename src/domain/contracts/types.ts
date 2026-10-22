/**
 * Tipos del contrato v1 compartidos por app, backend y runtime.
 * Reflejan `contracts/schemas/*.json`; los fixtures de `contracts/fixtures/`
 * se validan contra ambos en `tests/contracts.test.ts`.
 */
import type { AppErrorCode } from '../errors.ts';
import type {
  ConsentScope,
  Decision,
  Mode,
  ProposalStatus,
  ReceptionStatus,
  ScheduleMechanism,
  ScheduleReportStatus,
  SchedulingStatus,
} from '../states.ts';

export const SCHEMA_VERSION = 1;
export type SchemaVersion = typeof SCHEMA_VERSION;

/** Límites acordados para no permitir payloads arbitrarios (TDD §7). */
export const CONTRACT_LIMITS = {
  identifierLength: 128,
  titleLength: 120,
  noteLength: 500,
  reasonLength: 200,
  maxRecipients: 6,
  maxAgentTextLength: 2000,
} as const;

/** Instante resuelto + hora civil propuesta. Se conservan ambos a propósito. */
export type TimeSpec = {
  timeZone: string;
  localDate: string;
  localTime: string;
  effectiveAtEpochMs: number;
};

/** P0 solo admite repetición semanal de un día/hora, ligada a la zona del grupo. */
export type WeeklyRecurrence = {
  kind: 'WEEKLY';
  isoWeekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  localTime: string;
  untilEpochMs?: number;
};

export type CreateAlarmRequestPayload = {
  title: string;
  note?: string;
  taskId?: string;
  recipientUids: string[];
  mode: Mode;
  timeSpec: TimeSpec;
  recurrence?: WeeklyRecurrence;
};

export type RespondToAlarmPayload = {
  decision: 'ACCEPTED' | 'REJECTED' | 'DISABLED';
  chosenTimeSpec?: TimeSpec;
  consentScope?: ConsentScope;
  reason?: string;
};

export type ReportSchedulePayload = {
  occurrenceId: string;
  deviceId: string;
  deviceEpoch: number;
  requestVersion: number;
  decisionRevision: number;
  mode: Mode;
  mechanism: ScheduleMechanism;
  status: ScheduleReportStatus;
  effectiveAtEpochMs: number;
  reportedAtEpochMs: number;
  reason?: string;
};

export type WithdrawAlarmRequestPayload = {
  reason: string;
};

export type OperationKind =
  | 'createAlarmRequest'
  | 'respondToAlarm'
  | 'reportSchedule'
  | 'withdrawAlarmRequest';

/** Sobre común. `uid` nunca viaja como autoridad: sale de Auth en el servidor. */
export type OperationEnvelope<TPayload> = {
  schemaVersion: SchemaVersion;
  operationId: string;
  groupId: string;
  entityId?: string;
  expectedRequestVersion?: number;
  expectedDecisionRevision?: number;
  payload: TPayload;
};

export type CreateAlarmRequest = OperationEnvelope<CreateAlarmRequestPayload>;
export type RespondToAlarm = OperationEnvelope<RespondToAlarmPayload>;
export type ReportSchedule = OperationEnvelope<ReportSchedulePayload>;
export type WithdrawAlarmRequest = OperationEnvelope<WithdrawAlarmRequestPayload>;
export type AlarmCommand =
  | CreateAlarmRequest
  | RespondToAlarm
  | ReportSchedule
  | WithdrawAlarmRequest;

export type OperationReceipt = {
  operationId: string;
  status: 'APPLIED' | 'REPLAYED';
  serverTimeEpochMs: number;
  requestVersion?: number;
  decisionRevision?: number;
  result?: Record<string, unknown>;
};

export type AppErrorPayload = {
  code: AppErrorCode;
  message: string;
  retryable?: boolean;
  serverTimeEpochMs?: number;
  details?: Record<string, unknown>;
};

/** `groups/{groupId}/alarmRequests/{requestId}` */
export type AlarmRequestDocument = {
  creatorUid: string;
  title: string;
  note?: string;
  taskId?: string;
  recipientUids: string[];
  requestVersion: number;
  status: ProposalStatus;
  timeSpec: TimeSpec;
  mode: Mode;
  recurrence?: WeeklyRecurrence;
  createdAtEpochMs: number;
  updatedAtEpochMs: number;
  withdrawnAtEpochMs?: number;
  expiredAtEpochMs?: number;
};

/** `alarmRequests/{requestId}/recipients/{uid}` */
export type RecipientDocument = {
  uid: string;
  receivedVersion: number;
  reception: ReceptionStatus;
  decision: Decision;
  decisionRevision: number;
  acceptedRequestVersion?: number;
  chosenTimeSpec?: TimeSpec;
  consentScope?: ConsentScope;
  reason?: string;
  updatedAtEpochMs: number;
};

/** `recipients/{uid}/schedules/{occurrenceId}` */
export type ScheduleDocument = Omit<ReportSchedulePayload, 'status'> & {
  status: SchedulingStatus;
  statusUpdatedAtEpochMs: number;
};
