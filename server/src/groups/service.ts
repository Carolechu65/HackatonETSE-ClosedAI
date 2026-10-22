import { DomainError } from '../../../src/domain/errors.ts';
import { generateId } from '../lib/ids.ts';
import { readString } from '../lib/validation.ts';
import type { Db } from '../persistence/db.ts';
import { appendChangeEvent } from '../persistence/events.ts';

export type GroupSummary = {
  groupId: string;
  name: string;
  timeZone: string;
  role: 'OWNER' | 'MEMBER';
  memberCount: number;
};

export type MemberSummary = {
  uid: string;
  displayName: string;
  role: 'OWNER' | 'MEMBER';
};

type MembershipRow = {
  group_id: string;
  user_id: string;
  role: 'OWNER' | 'MEMBER';
  status: 'ACTIVE' | 'REMOVED';
};

export function requireActiveMembership(db: Db, groupId: string, uid: string): MembershipRow {
  const row = db
    .prepare('SELECT group_id, user_id, role, status FROM memberships WHERE group_id = ? AND user_id = ?')
    .get(groupId, uid) as MembershipRow | undefined;
  if (!row || row.status !== 'ACTIVE') {
    throw new DomainError('NOT_FOUND', 'Grupo no encontrado.');
  }
  return row;
}

export function isActiveMember(db: Db, groupId: string, uid: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM memberships WHERE group_id = ? AND user_id = ? AND status = 'ACTIVE'")
    .get(groupId, uid);
  return Boolean(row);
}

export function listGroups(db: Db, uid: string): GroupSummary[] {
  const rows = db
    .prepare(
      `SELECT g.id, g.name, g.time_zone, m.role,
              (SELECT COUNT(*) FROM memberships m2
                WHERE m2.group_id = g.id AND m2.status = 'ACTIVE') AS member_count
       FROM memberships m JOIN groups g ON g.id = m.group_id
       WHERE m.user_id = ? AND m.status = 'ACTIVE'
       ORDER BY g.name, g.id`,
    )
    .all(uid) as Array<{
      id: string;
      name: string;
      time_zone: string;
      role: 'OWNER' | 'MEMBER';
      member_count: number;
    }>;
  return rows.map((row) => ({
    groupId: row.id,
    name: row.name,
    timeZone: row.time_zone,
    role: row.role,
    memberCount: row.member_count,
  }));
}

export function createGroup(
  db: Db,
  uid: string,
  input: { name: string; timeZone: string },
  nowEpochMs = Date.now(),
): { groupId: string } {
  const name = readString(input.name, 'body.name', { max: 80 });
  const timeZone = readString(input.timeZone, 'body.timeZone', { max: 64 });
  assertTimeZone(timeZone);
  const groupId = generateId('grp');
  db.transaction(() => {
    db.prepare(
      `INSERT INTO groups (id, name, time_zone, created_by, created_at_epoch_ms, updated_at_epoch_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(groupId, name, timeZone, uid, nowEpochMs, nowEpochMs);
    db.prepare(
      `INSERT INTO memberships (group_id, user_id, role, status, joined_at_epoch_ms)
       VALUES (?, ?, 'OWNER', 'ACTIVE', ?)`,
    ).run(groupId, uid, nowEpochMs);
    appendChangeEvent(db, {
      audienceUid: uid,
      groupId,
      entityType: 'group',
      entityId: groupId,
      entityVersion: 1,
      kind: 'UPSERT',
      payload: { groupId, name, timeZone, role: 'OWNER' },
      nowEpochMs,
    });
  })();
  return { groupId };
}

export function listMembers(db: Db, uid: string, groupId: string): MemberSummary[] {
  requireActiveMembership(db, groupId, uid);
  const rows = db
    .prepare(
      `SELECT u.id, u.display_name, m.role
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ? AND m.status = 'ACTIVE'
       ORDER BY u.display_name, u.id`,
    )
    .all(groupId) as Array<{ id: string; display_name: string; role: 'OWNER' | 'MEMBER' }>;
  return rows.map((row) => ({ uid: row.id, displayName: row.display_name, role: row.role }));
}

export function removeMember(
  db: Db,
  actorUid: string,
  groupId: string,
  targetUid: string,
  nowEpochMs = Date.now(),
): void {
  const membership = requireActiveMembership(db, groupId, actorUid);
  if (membership.role !== 'OWNER') {
    throw new DomainError('FORBIDDEN', 'Solo quien creó el piso puede retirar a otra persona.');
  }
  if (targetUid === actorUid) {
    throw new DomainError('FORBIDDEN', 'Para salir del piso usa la ruta de salida.');
  }
  const target = db
    .prepare("SELECT role, status FROM memberships WHERE group_id = ? AND user_id = ?")
    .get(groupId, targetUid) as { role: 'OWNER' | 'MEMBER'; status: 'ACTIVE' | 'REMOVED' } | undefined;
  if (!target || target.status !== 'ACTIVE') throw new DomainError('NOT_FOUND', 'Miembro no encontrado.');
  if (target.role === 'OWNER') throw new DomainError('FORBIDDEN', 'No se puede retirar al propietario.');

  db.transaction(() => {
    db.prepare(
      "UPDATE memberships SET status = 'REMOVED', removed_at_epoch_ms = ? WHERE group_id = ? AND user_id = ?",
    ).run(nowEpochMs, groupId, targetUid);
    invalidateConsent(db,groupId,targetUid,nowEpochMs);
    const memberVersion = nowEpochMs;
    appendChangeEvent(db, {
      audienceUid: targetUid,
      groupId,
      entityType: 'membership',
      entityId: `${groupId}:${targetUid}`,
      entityVersion: memberVersion,
      kind: 'REVOKED',
      payload: { groupId, uid: targetUid },
      nowEpochMs,
    });
    const others = db
      .prepare("SELECT user_id FROM memberships WHERE group_id = ? AND status = 'ACTIVE'")
      .all(groupId) as Array<{ user_id: string }>;
    for (const other of others) {
      appendChangeEvent(db, {
        audienceUid: other.user_id,
        groupId,
        entityType: 'membership',
        entityId: `${groupId}:${targetUid}`,
        entityVersion: memberVersion,
        kind: 'TOMBSTONE',
        payload: { groupId, uid: targetUid },
        nowEpochMs,
      });
    }
  })();
}

export function leaveGroup(db: Db, uid: string, groupId: string, nowEpochMs = Date.now()): void {
  const membership = requireActiveMembership(db, groupId, uid);
  if (membership.role === 'OWNER') {
    const others = db
      .prepare("SELECT COUNT(*) AS count FROM memberships WHERE group_id = ? AND status = 'ACTIVE' AND user_id <> ?")
      .get(groupId, uid) as { count: number };
    if (others.count > 0) {
      throw new DomainError('FORBIDDEN', 'Transfiere el piso antes de salir o retira a los demás miembros.');
    }
  }
  db.transaction(() => {
    db.prepare(
      "UPDATE memberships SET status = 'REMOVED', removed_at_epoch_ms = ? WHERE group_id = ? AND user_id = ?",
    ).run(nowEpochMs, groupId, uid);
    invalidateConsent(db,groupId,uid,nowEpochMs);
    appendChangeEvent(db, {
      audienceUid: uid,
      groupId,
      entityType: 'membership',
      entityId: `${groupId}:${uid}`,
      entityVersion: nowEpochMs,
      kind: 'REVOKED',
      payload: { groupId, uid },
      nowEpochMs,
    });
  })();
}

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new DomainError('INVALID_ARGUMENT', 'body.timeZone: zona IANA desconocida.');
  }
}

function invalidateConsent(db:Db,groupId:string,uid:string,now:number):void {
 db.prepare("UPDATE alarm_recipients SET decision='NEEDS_REVIEW',decision_revision=decision_revision+1,accepted_request_version=NULL,consent_scope=NULL,chosen_time_zone=NULL,chosen_local_date=NULL,chosen_local_time=NULL,chosen_effective_at_epoch_ms=NULL,updated_at_epoch_ms=? WHERE uid=? AND decision='ACCEPTED' AND request_id IN (SELECT id FROM alarm_requests WHERE group_id=?)").run(now,uid,groupId);
 db.prepare("UPDATE device_schedules SET status='CANCEL_PENDING',status_updated_at_epoch_ms=? WHERE uid=? AND request_id IN (SELECT id FROM alarm_requests WHERE group_id=?) AND status IN ('SCHEDULED','SCHEDULING','PENDING_PERMISSION')").run(now,uid,groupId);
}
