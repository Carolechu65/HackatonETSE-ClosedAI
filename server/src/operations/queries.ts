import { DomainError } from '../../../src/domain/errors.ts';
import type { ScheduleDocument } from '../../../src/domain/contracts/types.ts';
import type { Db } from '../persistence/db.ts';
import { requireActiveMembership } from '../groups/service.ts';
import {
  alarmRequestDto,
  getAlarmRequest,
  getRecipient,
  getRecipientUids,
  listRecipients,
  recipientDto,
  scheduleDto,
  withRecipientUids,
  type AlarmRequestRow,
  type ScheduleRow,
} from './dto.ts';

export type AlarmListItem = {
  requestId: string;
  request: ReturnType<typeof alarmRequestDto>;
  /** `null` cuando el actor es el creador y no es destinatario. */
  recipient: ReturnType<typeof recipientDto> | null;
};

type ListCursor = { v: 1; groupId: string; offset: number };

function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeListCursor(cursor: string, groupId: string): number {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new DomainError('INVALID_ARGUMENT', 'cursor: cursor no válido.');
  }
  if (payload === null || typeof payload !== 'object') {
    throw new DomainError('INVALID_ARGUMENT', 'cursor: cursor no válido.');
  }
  const record = payload as Record<string, unknown>;
  if (record.v !== 1 || record.groupId !== groupId || !Number.isSafeInteger(record.offset)
    || (record.offset as number) < 0) {
    throw new DomainError('INVALID_ARGUMENT', 'cursor: cursor no válido para este grupo.');
  }
  return record.offset as number;
}

export function listAlarmRequests(
  db: Db,
  actorUid: string,
  groupId: string,
  options: { limit?: number; cursor?: string | null } = {},
): { items: AlarmListItem[]; nextCursor: string | null } {
  requireActiveMembership(db, groupId, actorUid);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const offset = options.cursor ? decodeListCursor(options.cursor, groupId) : 0;

  const rows = db
    .prepare(
      `SELECT DISTINCT ar.* FROM alarm_requests ar
       LEFT JOIN alarm_recipients r ON r.request_id = ar.id
       WHERE ar.group_id = ? AND (ar.creator_uid = ? OR r.uid = ?)
       ORDER BY ar.updated_at_epoch_ms DESC, ar.id
       LIMIT ? OFFSET ?`,
    )
    .all(groupId, actorUid, actorUid, limit + 1, offset) as AlarmRequestRow[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = page.map((row) => {
    const recipient = getRecipient(db, row.id, actorUid);
    return {
      requestId: row.id,
      request: withRecipientUids(alarmRequestDto(row), getRecipientUids(db, row.id)),
      recipient: recipient ? recipientDto(recipient) : null,
    };
  });
  return {
    items,
    nextCursor: hasMore ? encodeListCursor({ v: 1, groupId, offset: offset + limit }) : null,
  };
}

export type AlarmDetail = {
  request: ReturnType<typeof alarmRequestDto>;
  /** `null` cuando el actor es el creador y no es destinatario. */
  recipient: ReturnType<typeof recipientDto> | null;
  /** Solo el creador ve el estado de todos; el destinatario recibe `null`. */
  recipients: ReturnType<typeof recipientDto>[] | null;
  schedules: ScheduleDocument[];
};

function readScheduleRows(
  db: Db,
  actorUid: string,
  requestId: string,
  isCreator: boolean,
): ScheduleRow[] {
  return db
    .prepare(
      `SELECT schedules.* FROM device_schedules schedules
       JOIN users recipient ON recipient.id = schedules.uid
         AND recipient.primary_device_id = schedules.device_id AND recipient.device_epoch = schedules.device_epoch
       WHERE schedules.request_id = ? ${isCreator ? '' : 'AND schedules.uid = ?'}
       ORDER BY schedules.effective_at_epoch_ms, schedules.occurrence_id`,
    )
    .all(...(isCreator ? [requestId] : [requestId, actorUid])) as ScheduleRow[];
}

export function readAlarmRequest(db: Db, actorUid: string, groupId: string, requestId: string): AlarmDetail {
  requireActiveMembership(db, groupId, actorUid);
  const request = getAlarmRequest(db, requestId);
  if (!request || request.group_id !== groupId) throw new DomainError('NOT_FOUND', 'Propuesta no encontrada.');

  const isCreator = request.creator_uid === actorUid;
  const actorRecipient = getRecipient(db, requestId, actorUid);
  if (!isCreator && !actorRecipient) {
    throw new DomainError('NOT_FOUND', 'Propuesta no encontrada.');
  }

  return {
    request: withRecipientUids(alarmRequestDto(request), getRecipientUids(db, requestId)),
    recipient: actorRecipient ? recipientDto(actorRecipient) : null,
    recipients: isCreator ? listRecipients(db, requestId).map(recipientDto) : null,
    schedules: readScheduleRows(db, actorUid, requestId, isCreator).map(scheduleDto),
  };
}

export function listSchedules(
  db: Db,
  actorUid: string,
  groupId: string,
  requestId: string,
): Array<Record<string, unknown>> {
  const detail = readAlarmRequest(db, actorUid, groupId, requestId);
  const creator = detail.request.creatorUid === actorUid;
  return db
    .prepare(
      `SELECT schedules.* FROM device_schedules schedules
       JOIN users recipient ON recipient.id = schedules.uid
         AND recipient.primary_device_id = schedules.device_id AND recipient.device_epoch = schedules.device_epoch
       WHERE schedules.request_id = ? ${creator ? '' : 'AND schedules.uid = ?'}
       ORDER BY schedules.effective_at_epoch_ms, schedules.occurrence_id`,
    )
    .all(...(creator ? [requestId] : [requestId, actorUid])) as Array<Record<string, unknown>>;
}
