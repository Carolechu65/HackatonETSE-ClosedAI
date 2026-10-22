import type { Db } from '../persistence/db.ts';

/** Read-only inbox across current memberships; opening a notice grants no consent. */
export function listAssignments(db: Db, userId: string, now = Date.now()) {
  const alarms = db.prepare(`SELECT a.id,a.group_id,a.title,a.mode,a.request_version,r.decision_revision,u.display_name
    FROM alarm_requests a JOIN alarm_recipients r ON r.request_id=a.id
    JOIN memberships m ON m.group_id=a.group_id AND m.user_id=r.uid AND m.status='ACTIVE'
    JOIN users u ON u.id=a.creator_uid
    WHERE r.uid=? AND a.creator_uid<>? AND a.status='ACTIVE' AND r.decision IN ('PENDING','NEEDS_REVIEW')
    AND (a.effective_at_epoch_ms>? OR (a.recurrence_kind IS NOT NULL AND (a.recurrence_until_epoch_ms IS NULL OR a.recurrence_until_epoch_ms>?)))
    ORDER BY a.created_at_epoch_ms DESC LIMIT 250`).all(userId, userId, now, now) as Array<{
      id: string; group_id: string; title: string; mode: string; request_version: number; decision_revision: number; display_name: string;
    }>;
  const tasks = db.prepare(`SELECT t.id,t.group_id,t.title,t.version,u.display_name FROM tasks t
    JOIN memberships m ON m.group_id=t.group_id AND m.user_id=t.assigned_to AND m.status='ACTIVE'
    JOIN users u ON u.id=t.created_by_uid
    WHERE t.assigned_to=? AND t.created_by_uid<>? AND t.status='PENDING' AND t.assignment_decision='pending'
    ORDER BY t.created_at_epoch_ms DESC LIMIT 250`).all(userId, userId) as Array<{
      id: string; group_id: string; title: string; version: number; display_name: string;
    }>;
  return { assignments: [
    ...alarms.map(a => ({ id: `alarm:${a.id}:${a.request_version}:${a.decision_revision}`, kind: 'alarm' as const,
      entityId: a.id, groupId: a.group_id, version: a.request_version, title: a.title,
      body: `${a.display_name} te propone ${a.mode === 'ALARM' ? 'una alarma' : 'una notificación'}. Abre para aceptar o rechazar.` })),
    ...tasks.map(t => ({ id: `task:${t.id}:${t.version}`, kind: 'task' as const, entityId: t.id,
      groupId: t.group_id, version: t.version, title: t.title,
      body: `${t.display_name} te ha asignado una tarea. Abre para aceptar o rechazar.` })),
  ] };
}
