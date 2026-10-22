import type {
  AlarmRequestDocument,
  RecipientDocument,
  ScheduleDocument,
} from '../../../src/domain/contracts/types.ts';
import type { SchedulingStatus } from '../../../src/domain/states.ts';
import type { Db } from '../persistence/db.ts';

export type AlarmRequestRow = {
  id: string;
  group_id: string;
  creator_uid: string;
  title: string;
  note: string | null;
  task_id: string | null;
  request_version: number;
  status: 'ACTIVE' | 'WITHDRAWN' | 'EXPIRED';
  time_zone: string;
  local_date: string;
  local_time: string;
  effective_at_epoch_ms: number;
  mode: 'ALARM' | 'NOTIFICATION';
  recurrence_kind: 'WEEKLY' | null;
  recurrence_weekday: number | null;
  recurrence_local_time: string | null;
  recurrence_until_epoch_ms: number | null;
  created_at_epoch_ms: number;
  updated_at_epoch_ms: number;
  withdrawn_at_epoch_ms: number | null;
  expired_at_epoch_ms: number | null;
};

export type RecipientRow = {
  request_id: string;
  uid: string;
  received_version: number;
  reception: 'NOT_ACKNOWLEDGED' | 'RECEIVED';
  decision: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'DISABLED' | 'NEEDS_REVIEW';
  decision_revision: number;
  accepted_request_version: number | null;
  chosen_time_zone: string | null;
  chosen_local_date: string | null;
  chosen_local_time: string | null;
  chosen_effective_at_epoch_ms: number | null;
  consent_scope: 'THIS_OCCURRENCE' | 'SERIES' | null;
  reason: string | null;
  updated_at_epoch_ms: number;
};

export type ScheduleRow = {
  request_id: string;
  uid: string;
  occurrence_id: string;
  device_id: string;
  device_epoch: number;
  request_version: number;
  decision_revision: number;
  mode: 'ALARM' | 'NOTIFICATION';
  mechanism: 'ALARM_RUNTIME' | 'EXPO_NOTIFICATIONS';
  status: SchedulingStatus;
  effective_at_epoch_ms: number;
  reported_at_epoch_ms: number;
  status_updated_at_epoch_ms: number;
  reason: string | null;
};

export function alarmRequestDto(row: AlarmRequestRow): AlarmRequestDocument {
  const document: AlarmRequestDocument = {
    creatorUid: row.creator_uid,
    title: row.title,
    recipientUids: [],
    requestVersion: row.request_version,
    status: row.status,
    timeSpec: {
      timeZone: row.time_zone,
      localDate: row.local_date,
      localTime: row.local_time,
      effectiveAtEpochMs: row.effective_at_epoch_ms,
    },
    mode: row.mode,
    createdAtEpochMs: row.created_at_epoch_ms,
    updatedAtEpochMs: row.updated_at_epoch_ms,
  };
  if (row.note !== null) document.note = row.note;
  if (row.task_id !== null) document.taskId = row.task_id;
  if (row.recurrence_kind === 'WEEKLY' && row.recurrence_weekday !== null && row.recurrence_local_time !== null) {
    document.recurrence = {
      kind: 'WEEKLY',
      isoWeekday: row.recurrence_weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      localTime: row.recurrence_local_time,
    };
    if (row.recurrence_until_epoch_ms !== null) document.recurrence.untilEpochMs = row.recurrence_until_epoch_ms;
  }
  if (row.withdrawn_at_epoch_ms !== null) document.withdrawnAtEpochMs = row.withdrawn_at_epoch_ms;
  if (row.expired_at_epoch_ms !== null) document.expiredAtEpochMs = row.expired_at_epoch_ms;
  return document;
}

export function withRecipientUids(document: AlarmRequestDocument, uids: string[]): AlarmRequestDocument {
  return { ...document, recipientUids: [...uids] };
}

export function recipientDto(row: RecipientRow): RecipientDocument {
  const document: RecipientDocument = {
    uid: row.uid,
    receivedVersion: row.received_version,
    reception: row.reception,
    decision: row.decision,
    decisionRevision: row.decision_revision,
    updatedAtEpochMs: row.updated_at_epoch_ms,
  };
  if (row.accepted_request_version !== null) document.acceptedRequestVersion = row.accepted_request_version;
  if (row.chosen_time_zone !== null && row.chosen_local_date !== null && row.chosen_local_time !== null
    && row.chosen_effective_at_epoch_ms !== null) {
    document.chosenTimeSpec = {
      timeZone: row.chosen_time_zone,
      localDate: row.chosen_local_date,
      localTime: row.chosen_local_time,
      effectiveAtEpochMs: row.chosen_effective_at_epoch_ms,
    };
  }
  if (row.consent_scope !== null) document.consentScope = row.consent_scope;
  if (row.reason !== null) document.reason = row.reason;
  return document;
}

export function scheduleDto(row: ScheduleRow): ScheduleDocument {
  const document: ScheduleDocument = {
    occurrenceId: row.occurrence_id,
    deviceId: row.device_id,
    deviceEpoch: row.device_epoch,
    requestVersion: row.request_version,
    decisionRevision: row.decision_revision,
    mode: row.mode,
    mechanism: row.mechanism,
    status: row.status,
    effectiveAtEpochMs: row.effective_at_epoch_ms,
    reportedAtEpochMs: row.reported_at_epoch_ms,
    statusUpdatedAtEpochMs: row.status_updated_at_epoch_ms,
  };
  if (row.reason !== null) document.reason = row.reason;
  return document;
}

export function getAlarmRequest(db: Db, requestId: string): AlarmRequestRow | undefined {
  return db.prepare('SELECT * FROM alarm_requests WHERE id = ?').get(requestId) as AlarmRequestRow | undefined;
}

export function getRecipient(db: Db, requestId: string, uid: string): RecipientRow | undefined {
  return db
    .prepare('SELECT * FROM alarm_recipients WHERE request_id = ? AND uid = ?')
    .get(requestId, uid) as RecipientRow | undefined;
}

export function getRecipientUids(db: Db, requestId: string): string[] {
  const rows = db
    .prepare('SELECT uid FROM alarm_recipients WHERE request_id = ? ORDER BY uid')
    .all(requestId) as Array<{ uid: string }>;
  return rows.map((row) => row.uid);
}

export function listRecipients(db: Db, requestId: string): RecipientRow[] {
  return db
    .prepare('SELECT * FROM alarm_recipients WHERE request_id = ? ORDER BY uid')
    .all(requestId) as RecipientRow[];
}

export function getSchedule(
  db: Db,
  requestId: string,
  uid: string,
  occurrenceId: string,
  deviceId: string,
  deviceEpoch: number,
): ScheduleRow | undefined {
  return db
    .prepare(
      `SELECT * FROM device_schedules
       WHERE request_id = ? AND uid = ? AND occurrence_id = ? AND device_id = ? AND device_epoch = ?`,
    )
    .get(requestId, uid, occurrenceId, deviceId, deviceEpoch) as ScheduleRow | undefined;
}
