import { DomainError } from '../../../src/domain/errors.ts';
import type { SyncChange, SyncEntityType, SyncPage } from '../../../src/domain/contracts/types.ts';
import type { Db } from '../persistence/db.ts';
import { appendChangeEvent } from '../persistence/events.ts';
import { listGroups, requireActiveMembership } from '../groups/service.ts';

type ChangeRow = {
  sequence: number;
  audience_uid: string;
  group_id: string;
  entity_type: string;
  entity_id: string;
  entity_version: number;
  kind: 'UPSERT' | 'TOMBSTONE' | 'REVOKED';
  payload_json: string | null;
  created_at_epoch_ms: number;
};

type CursorPayload = { v: 1; uid: string; seq: number };

const ENTITY_TYPE_MAP: Readonly<Record<string, SyncEntityType>> = {
  alarm_request: 'ALARM_REQUEST',
  recipient: 'RECIPIENT',
  schedule: 'SCHEDULE',
  task: 'TASK',
  membership: 'GROUP_MEMBERSHIP',
  group: 'GROUP',
  device: 'DEVICE',
};

const KIND_MAP: Readonly<Record<ChangeRow['kind'], SyncChange['kind']>> = {
  UPSERT: 'UPSERT',
  TOMBSTONE: 'DELETE',
  REVOKED: 'DELETE',
};

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string, actorUid: string): number {
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
  if (record.v !== 1 || record.uid !== actorUid || !Number.isSafeInteger(record.seq) || (record.seq as number) < 0) {
    throw new DomainError('INVALID_ARGUMENT', 'cursor: cursor no válido para esta sesión.');
  }
  return record.seq as number;
}

function activeMembership(db: Db, groupId: string, uid: string): boolean {
  if (!groupId) return true;
  return Boolean(
    db.prepare("SELECT 1 AS ok FROM memberships WHERE group_id = ? AND user_id = ? AND status = 'ACTIVE'")
      .get(groupId, uid),
  );
}

export function readSyncPage(
  db: Db,
  actorUid: string,
  cursor: string | null,
  limitInput: number | null,
): SyncPage {
  const limit = Math.min(Math.max(limitInput ?? 50, 1), 100);
  const after = cursor ? decodeCursor(cursor, actorUid) : 0;

  const rows = db
    .prepare(
      `SELECT sequence, audience_uid, group_id, entity_type, entity_id, entity_version, kind,
              payload_json, created_at_epoch_ms
       FROM change_events
       WHERE audience_uid = ? AND sequence > ?
       ORDER BY sequence ASC
       LIMIT ?`,
    )
    .all(actorUid, after, limit + 1) as ChangeRow[];

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const changes: SyncChange[] = pageRows.map((row) => {
    const authorized = row.kind === 'REVOKED' || activeMembership(db, row.group_id, actorUid);
    if (!authorized) {
      // Revocación mínima: no revela contenido nuevo del grupo.
      return {
        sequence: row.sequence,
        entityType: 'GROUP_MEMBERSHIP',
        entityId: `${row.group_id}:${actorUid}`,
        kind: 'DELETE',
        version: Math.max(1, row.entity_version),
        updatedAtEpochMs: row.created_at_epoch_ms,
      };
    }
    const entityType = ENTITY_TYPE_MAP[row.entity_type];
    if (!entityType) {
      throw new Error(`change_events: tipo de entidad no soportado (${row.entity_type}).`);
    }
    return {
      sequence: row.sequence,
      entityType,
      entityId: row.entity_id,
      kind: KIND_MAP[row.kind],
      version: Math.max(1, row.entity_version),
      updatedAtEpochMs: row.created_at_epoch_ms,
    };
  });

  const lastSequence = pageRows.length > 0 ? pageRows[pageRows.length - 1]!.sequence : after;
  return {
    changes,
    nextCursor: encodeCursor({ v: 1, uid: actorUid, seq: lastSequence }),
  };
}

/** Snapshot de arranque: grupos, IDs de propuestas visibles y cursor inicial. */
export function readSnapshot(db: Db, actorUid: string): Record<string, unknown> {
  const requests = db
    .prepare(
      `SELECT DISTINCT ar.id, ar.group_id FROM alarm_requests ar
       LEFT JOIN alarm_recipients r ON r.request_id = ar.id
       WHERE (ar.creator_uid = ? OR r.uid = ?)
         AND EXISTS (SELECT 1 FROM memberships m
                     WHERE m.group_id = ar.group_id AND m.user_id = ? AND m.status = 'ACTIVE')
       ORDER BY ar.updated_at_epoch_ms DESC, ar.id`,
    )
    .all(actorUid, actorUid, actorUid) as Array<{ id: string; group_id: string }>;

  return {
    groups: listGroups(db, actorUid),
    alarmRequestIds: requests.map((row) => ({ requestId: row.id, groupId: row.group_id })),
    cursor: encodeCursor({ v: 1, uid: actorUid, seq: 0 }),
    servedAtEpochMs: Date.now(),
  };
}

/** Marca de recepción explícita; no cambia la decisión ni programa nada. */
export function acknowledgeReception(
  db: Db,
  actorUid: string,
  requestId: string,
  requestVersion: number,
  nowEpochMs = Date.now(),
): void {
  const recipient = db
    .prepare('SELECT received_version, reception FROM alarm_recipients WHERE request_id = ? AND uid = ?')
    .get(requestId, actorUid) as { received_version: number; reception: string } | undefined;
  if (!recipient) throw new DomainError('NOT_FOUND', 'Propuesta no encontrada.');
  const request = db.prepare('SELECT group_id,request_version FROM alarm_requests WHERE id=?').get(requestId) as {
    group_id: string;
    request_version: number;
  } | undefined;
  if (!request) throw new DomainError('NOT_FOUND', 'Propuesta no encontrada.');
  // Un miembro retirado no puede seguir mutando su recepción.
  requireActiveMembership(db, request.group_id, actorUid);
  if (requestVersion !== request.request_version) {
    throw new DomainError('VERSION_CONFLICT', 'La propuesta cambió.');
  }
  if (requestVersion <= recipient.received_version && recipient.reception === 'RECEIVED') return;
  db.prepare(
    `UPDATE alarm_recipients SET received_version = ?, reception = 'RECEIVED', updated_at_epoch_ms = ?
     WHERE request_id = ? AND uid = ?`,
  ).run(requestVersion, nowEpochMs, requestId, actorUid);
  appendChangeEvent(db, {
    audienceUid: actorUid,
    groupId: request.group_id,
    entityType: 'recipient',
    entityId: `${requestId}:${actorUid}`,
    entityVersion: requestVersion,
    kind: 'UPSERT',
    payload: { requestId, uid: actorUid, receivedVersion: requestVersion, reception: 'RECEIVED' },
    nowEpochMs,
  });
}
