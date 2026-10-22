import { entityId } from '../lib/crypto.ts';
import type { Db } from './db.ts';

export type ChangeEventKind = 'UPSERT' | 'TOMBSTONE' | 'REVOKED';
export type ChangeEntityType = 'alarm_request' | 'recipient' | 'schedule' | 'membership' | 'group' | 'device';

export type AppendChangeInput = {
  audienceUid: string;
  groupId: string;
  entityType: ChangeEntityType;
  entityId: string;
  entityVersion: number;
  kind: ChangeEventKind;
  payload?: Record<string, unknown>;
  nowEpochMs: number;
};

/** Dentro de la misma transacción que el efecto de dominio. No hace red. */
export function appendChangeEvent(db: Db, input: AppendChangeInput): void {
  db.prepare(
    `INSERT INTO change_events
      (audience_uid, group_id, entity_type, entity_id, entity_version, kind, payload_json, created_at_epoch_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.audienceUid,
    input.groupId,
    input.entityType,
    input.entityId,
    input.entityVersion,
    input.kind,
    input.payload ? JSON.stringify(input.payload) : null,
    input.nowEpochMs,
  );
}

export type EnqueueOutboxInput = {
  audienceUid: string;
  groupId: string | null;
  kind: string;
  entityType: ChangeEntityType | 'task';
  entityId: string;
  entityVersion: number;
  payload: Record<string, unknown>;
  nowEpochMs: number;
};

/**
 * Aviso remoto opcional: solo IDs y versiones. El push nunca ordena sonar
 * una alarma; el dispositivo recupera el estado autorizado por HTTP.
 */
export function enqueueOutboxEvent(db: Db, input: EnqueueOutboxInput): string {
  const id = entityId('evt');
  db.prepare(
    `INSERT INTO outbox_events
      (id, audience_uid, group_id, kind, entity_type, entity_id, entity_version,
       payload_json, next_attempt_at_epoch_ms, created_at_epoch_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.audienceUid,
    input.groupId,
    input.kind,
    input.entityType,
    input.entityId,
    input.entityVersion,
    JSON.stringify(input.payload),
    input.nowEpochMs,
    input.nowEpochMs,
  );
  return id;
}
