import { DomainError } from '../../../src/domain/errors.ts';
import type { Db } from '../persistence/db.ts';
import { requireActiveMembership } from '../groups/service.ts';
import {
  alarmRequestDto,
  getAlarmRequest,
  getRecipient,
  getRecipientUids,
  listRecipients,
  recipientDto,
  withRecipientUids,
  type AlarmRequestRow,
} from './dto.ts';

export type AlarmListItem = {
  request: ReturnType<typeof alarmRequestDto>;
  recipient: ReturnType<typeof recipientDto> | null;
};

export function listAlarmRequests(
  db: Db,
  actorUid: string,
  groupId: string,
  options: { limit?: number; offset?: number } = {},
): { items: AlarmListItem[]; nextOffset: number | null } {
  requireActiveMembership(db, groupId, actorUid);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const offset = Math.max(options.offset ?? 0, 0);

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
      request: withRecipientUids(alarmRequestDto(row), getRecipientUids(db, row.id)),
      recipient: recipient ? recipientDto(recipient) : null,
    };
  });
  return { items, nextOffset: hasMore ? offset + limit : null };
}

export type AlarmDetail = {
  request: ReturnType<typeof alarmRequestDto>;
  recipient: ReturnType<typeof recipientDto> | null;
  recipients: ReturnType<typeof recipientDto>[] | null;
};

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
  const rows = db
    .prepare(
      `SELECT * FROM device_schedules WHERE request_id = ? ${creator ? '' : 'AND uid = ?'}
       ORDER BY effective_at_epoch_ms, occurrence_id`,
    )
    .all(...(creator ? [requestId] : [requestId, actorUid])) as Array<Record<string, unknown>>;
  return rows;
}
