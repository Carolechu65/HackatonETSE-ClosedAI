import { DomainError } from '../../../src/domain/errors.ts';
import type { Db } from '../persistence/db.ts';
import { appendChangeEvent } from '../persistence/events.ts';

export type SyncEvent = {
  sequence: number;
  kind: 'UPSERT' | 'TOMBSTONE' | 'REVOKED';
  entityType: string;
  entityId: string;
  groupId: string;
  entityVersion: number;
  payload: Record<string, unknown> | null;
  createdAtEpochMs: number;
};

export type SyncPage = {
  events: SyncEvent[];
  nextCursor: string;
  hasMore: boolean;
};

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
  nowEpochMs = Date.now(),
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
  const events: SyncEvent[] = pageRows.map((row) => {
    const authorized = row.kind === 'REVOKED' || activeMembership(db, row.group_id, actorUid);
    if (!authorized) {
      return {
        sequence: row.sequence,
        kind: 'REVOKED',
        entityType: 'membership',
        entityId: `${row.group_id}:${actorUid}`,
        groupId: row.group_id,
        entityVersion: row.entity_version,
        payload: { groupId: row.group_id },
        createdAtEpochMs: row.created_at_epoch_ms,
      };
    }
    let payload: Record<string, unknown> | null = null;
    if (row.payload_json) {
      try {
        payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      } catch {
        payload = null;
      }
    }
    return {
      sequence: row.sequence,
      kind: row.kind,
      entityType: row.entity_type,
      entityId: row.entity_id,
      groupId: row.group_id,
      entityVersion: row.entity_version,
      payload,
      createdAtEpochMs: row.created_at_epoch_ms,
    };
  });

  const lastSequence = pageRows.length > 0 ? pageRows[pageRows.length - 1]!.sequence : after;
  return {
    events,
    nextCursor: encodeCursor({ v: 1, uid: actorUid, seq: lastSequence }),
    hasMore,
  };
}

/** Snapshot de arranque: grupos, miembros, propuestas visibles y dispositivos. */
export function readSnapshot(db: Db, actorUid: string): Record<string, unknown> {
  const groups = db
    .prepare(
      `SELECT g.id, g.name, g.time_zone, m.role, m.joined_at_epoch_ms
       FROM memberships m JOIN groups g ON g.id = m.group_id
       WHERE m.user_id = ? AND m.status = 'ACTIVE' ORDER BY g.id`,
    )
    .all(actorUid);

  const requests = db
    .prepare(
      `SELECT DISTINCT ar.* FROM alarm_requests ar
       LEFT JOIN alarm_recipients r ON r.request_id = ar.id
       WHERE (ar.creator_uid = ? OR r.uid = ?)
         AND EXISTS (SELECT 1 FROM memberships m
                     WHERE m.group_id = ar.group_id AND m.user_id = ? AND m.status = 'ACTIVE')
       ORDER BY ar.updated_at_epoch_ms DESC, ar.id`,
    )
    .all(actorUid, actorUid, actorUid) as Array<{ id: string; group_id: string }>;

  return {
    groups,
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
  if (requestVersion <= recipient.received_version) return;
  db.prepare(
    `UPDATE alarm_recipients SET received_version = ?, reception = 'RECEIVED', updated_at_epoch_ms = ?
     WHERE request_id = ? AND uid = ?`,
  ).run(requestVersion, nowEpochMs, requestId, actorUid);
  appendChangeEvent(db, {
    audienceUid: actorUid,
    groupId: '',
    entityType: 'recipient',
    entityId: `${requestId}:${actorUid}`,
    entityVersion: requestVersion,
    kind: 'UPSERT',
    payload: { requestId, uid: actorUid, receivedVersion: requestVersion, reception: 'RECEIVED' },
    nowEpochMs,
  });
}
