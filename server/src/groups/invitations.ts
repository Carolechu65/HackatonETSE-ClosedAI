import { DomainError } from '../../../src/domain/errors.ts';
import { sha256Hex, createOpaqueToken } from '../lib/crypto.ts';
import { generateId } from '../lib/ids.ts';
import { readString } from '../lib/validation.ts';
import type { Db } from '../persistence/db.ts';
import { appendChangeEvent } from '../persistence/events.ts';
import { requireActiveMembership } from '../groups/service.ts';

const MIN_EXPIRY_MS = 5 * 60 * 1000;
const MAX_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000;

export type InvitationCreated = {
  invitationId: string;
  token: string;
  expiresAtEpochMs: number;
};

export function createInvitation(
  db: Db,
  actorUid: string,
  groupId: string,
  input: { expiresInMs?: number; role?: 'OWNER' | 'MEMBER' },
  nowEpochMs = Date.now(),
): InvitationCreated {
  const membership = requireActiveMembership(db, groupId, actorUid);
  if (membership.role !== 'OWNER') {
    throw new DomainError('FORBIDDEN', 'Solo quien creó el piso puede invitar.');
  }
  const expiresInMs = input.expiresInMs ?? DEFAULT_EXPIRY_MS;
  if (!Number.isSafeInteger(expiresInMs) || expiresInMs < MIN_EXPIRY_MS || expiresInMs > MAX_EXPIRY_MS) {
    throw new DomainError('INVALID_ARGUMENT', `body.expiresInMs: entre ${MIN_EXPIRY_MS} y ${MAX_EXPIRY_MS}.`);
  }
  const role = input.role ?? 'MEMBER';
  if (role !== 'MEMBER' && role !== 'OWNER') {
    throw new DomainError('INVALID_ARGUMENT', 'body.role: MEMBER u OWNER.');
  }
  const invitationId = generateId('inv');
  const token = createOpaqueToken();
  const expiresAtEpochMs = nowEpochMs + expiresInMs;
  db.prepare(
    `INSERT INTO invitations
      (id, group_id, created_by, token_hash, role, created_at_epoch_ms, expires_at_epoch_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(invitationId, groupId, actorUid, sha256Hex(token), role, nowEpochMs, expiresAtEpochMs);
  return { invitationId, token, expiresAtEpochMs };
}

export type InvitationAccepted = {
  groupId: string;
  alreadyMember: boolean;
};

type InvitationRow = {
  id: string;
  group_id: string;
  role: 'OWNER' | 'MEMBER';
  expires_at_epoch_ms: number;
  consumed_at_epoch_ms: number | null;
  consumed_by: string | null;
};

export function acceptInvitation(
  db: Db,
  actorUid: string,
  token: string,
  nowEpochMs = Date.now(),
): InvitationAccepted {
  const tokenHash = sha256Hex(token);
  const accept = db.transaction((): InvitationAccepted => {
    const invitation = db
      .prepare(
        `SELECT id, group_id, role, expires_at_epoch_ms, consumed_at_epoch_ms, consumed_by
         FROM invitations WHERE token_hash = ?`,
      )
      .get(tokenHash) as InvitationRow | undefined;
    if (!invitation) throw new DomainError('INVALID_ARGUMENT', 'Invitación no válida.');
    if (invitation.consumed_at_epoch_ms !== null) {
      if (invitation.consumed_by === actorUid) {
        return { groupId: invitation.group_id, alreadyMember: true };
      }
      throw new DomainError('INVALID_ARGUMENT', 'La invitación ya se utilizó.');
    }
    if (invitation.expires_at_epoch_ms <= nowEpochMs) {
      throw new DomainError('EXPIRED', 'La invitación ha caducado.');
    }

    const existing = db
      .prepare('SELECT status FROM memberships WHERE group_id = ? AND user_id = ?')
      .get(invitation.group_id, actorUid) as { status: 'ACTIVE' | 'REMOVED' } | undefined;

    if (existing?.status === 'ACTIVE') {
      db.prepare('UPDATE invitations SET consumed_at_epoch_ms = ?, consumed_by = ? WHERE id = ?')
        .run(nowEpochMs, actorUid, invitation.id);
      return { groupId: invitation.group_id, alreadyMember: true };
    }

    if (existing) {
      db.prepare(
        "UPDATE memberships SET status = 'ACTIVE', role = ?, joined_at_epoch_ms = ?, removed_at_epoch_ms = NULL WHERE group_id = ? AND user_id = ?",
      ).run(invitation.role, nowEpochMs, invitation.group_id, actorUid);
    } else {
      db.prepare(
        "INSERT INTO memberships (group_id, user_id, role, status, joined_at_epoch_ms) VALUES (?, ?, ?, 'ACTIVE', ?)",
      ).run(invitation.group_id, actorUid, invitation.role, nowEpochMs);
    }
    db.prepare('UPDATE invitations SET consumed_at_epoch_ms = ?, consumed_by = ? WHERE id = ?')
      .run(nowEpochMs, actorUid, invitation.id);

    const memberVersion = nowEpochMs;
    appendChangeEvent(db, {
      audienceUid: actorUid,
      groupId: invitation.group_id,
      entityType: 'membership',
      entityId: `${invitation.group_id}:${actorUid}`,
      entityVersion: memberVersion,
      kind: 'UPSERT',
      payload: { groupId: invitation.group_id, uid: actorUid, role: invitation.role },
      nowEpochMs,
    });
    const others = db
      .prepare("SELECT user_id FROM memberships WHERE group_id = ? AND status = 'ACTIVE' AND user_id <> ?")
      .all(invitation.group_id, actorUid) as Array<{ user_id: string }>;
    for (const other of others) {
      appendChangeEvent(db, {
        audienceUid: other.user_id,
        groupId: invitation.group_id,
        entityType: 'membership',
        entityId: `${invitation.group_id}:${actorUid}`,
        entityVersion: memberVersion,
        kind: 'UPSERT',
        payload: { groupId: invitation.group_id, uid: actorUid, role: invitation.role },
        nowEpochMs,
      });
    }
    return { groupId: invitation.group_id, alreadyMember: false };
  });
  return accept.immediate();
}

export function readToken(value: unknown): string {
  const token = readString(value, 'params.token', { max: 512 });
  if (token.length < 32) throw new DomainError('INVALID_ARGUMENT', 'Invitación no válida.');
  return token;
}
