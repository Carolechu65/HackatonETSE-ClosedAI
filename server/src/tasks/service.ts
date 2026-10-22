import { DomainError } from '../../../src/domain/errors.ts';
import { requireActiveMembership, isActiveMember } from '../groups/service.ts';
import { generateId } from '../lib/ids.ts';
import { canonicalJson, sha256Hex } from '../lib/crypto.ts';
import {
  asRecord,
  assertNoExtraKeys,
  readIdentifier,
  readString,
  readPositiveInt,
} from '../lib/validation.ts';
import type { Db } from '../persistence/db.ts';
import { appendChangeEvent, enqueueOutboxEvent } from '../persistence/events.ts';
import {
  getAlarmRequest,
  getRecipient,
  getRecipientUids,
  alarmRequestDto,
  recipientDto,
  type AlarmRequestRow,
} from '../operations/dto.ts';
export type HouseholdTask = {
  id: string;
  groupId: string;
  title: string;
  description: string | null;
  category: string | null;
  assigneeUid: string | null;
  createdByUid: string;
  activateAtEpochMs: number | null;
  dueAtEpochMs: number | null;
  status: 'pending' | 'completed' | 'cancelled';
  version: number;
  completedByUid: string | null;
  completedAtEpochMs: number | null;
};
type TaskRow = {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  category: string | null;
  assigned_to: string | null;
  created_by_uid: string;
  activate_at_epoch_ms: number | null;
  due_at_epoch_ms: number | null;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  version: number;
  completed_by_uid: string | null;
  completed_at_epoch_ms: number | null;
};
const dto = (r: TaskRow): HouseholdTask => ({
  id: r.id,
  groupId: r.group_id,
  title: r.title,
  description: r.description,
  category: r.category,
  assigneeUid: r.assigned_to,
  createdByUid: r.created_by_uid,
  activateAtEpochMs: r.activate_at_epoch_ms,
  dueAtEpochMs: r.due_at_epoch_ms,
  status: r.status.toLowerCase() as HouseholdTask['status'],
  version: r.version,
  completedByUid: r.completed_by_uid,
  completedAtEpochMs: r.completed_at_epoch_ms,
});
const epoch = (value: unknown): number | null => {
  if (value === undefined || value === null) return null;
  return readPositiveInt(value, 'fecha', 0);
};
function operation(
  db: Db,
  user: string,
  kind: string,
  input: Record<string, unknown>,
  now: number,
  action: () => HouseholdTask,
): HouseholdTask {
  const operationId = readIdentifier(input.operationId, 'operationId'),
    digest = sha256Hex(canonicalJson(input));
  const prior = db
    .prepare(
      'SELECT operation_name,input_hash,result_json FROM operations WHERE actor_uid=? AND operation_id=?',
    )
    .get(user, operationId) as
    { operation_name: string; input_hash: string; result_json: string } | undefined;
  if (prior) {
    if (prior.operation_name !== kind || prior.input_hash !== digest)
      throw new DomainError('VERSION_CONFLICT', 'operationId reutilizado con otra entrada.');
    return JSON.parse(prior.result_json) as HouseholdTask;
  }
  const result = action();
  db.prepare('INSERT INTO operations VALUES (?,?,?,?,?,?)').run(
    user,
    operationId,
    kind,
    digest,
    JSON.stringify(result),
    now,
  );
  return result;
}
export function listTasks(db: Db, user: string, groupId: string): { tasks: HouseholdTask[] } {
  requireActiveMembership(db, groupId, user);
  return {
    tasks: (
      db
        .prepare('SELECT * FROM tasks WHERE group_id=? ORDER BY due_at_epoch_ms,id LIMIT 500')
        .all(groupId) as TaskRow[]
    ).map(dto),
  };
}
export function createTask(
  db: Db,
  user: string,
  groupId: string,
  raw: unknown,
  now = Date.now(),
): HouseholdTask {
  const data = asRecord(raw);
  assertNoExtraKeys(data, [
    'operationId',
    'title',
    'description',
    'category',
    'assigneeUid',
    'activateAtEpochMs',
    'dueAtEpochMs',
  ]);
  return db
    .transaction(() => {
      requireActiveMembership(db, groupId, user);
      return operation(db, user, 'createTask', { ...data, groupId }, now, () => {
        const title = readString(data.title, 'title', { max: 120 }),
          description = data.description == null || data.description === '' ? null : readString(data.description, 'description', { max: 2000 }),
          category = data.category == null || data.category === '' ? null : readString(data.category, 'category', { max: 80 }),
          assignee =
            data.assigneeUid === null || data.assigneeUid === undefined
              ? null
              : readIdentifier(data.assigneeUid, 'assigneeUid'),
          activate = epoch(data.activateAtEpochMs),
          due = epoch(data.dueAtEpochMs);
        if (assignee && !isActiveMember(db, groupId, assignee))
          throw new DomainError('FORBIDDEN', 'El responsable no pertenece al piso.');
        if (activate !== null && due !== null && due < activate)
          throw new DomainError('INVALID_ARGUMENT', 'Vencimiento anterior a activación.');
        const id = generateId('task');
        db.prepare(
          "INSERT INTO tasks(id,group_id,title,assigned_to,activate_at_epoch_ms,due_at_epoch_ms,status,version,created_at_epoch_ms,updated_at_epoch_ms,created_by_uid,description,category) VALUES (?,?,?,?,?,?,'PENDING',1,?,?,?,?,?)",
        ).run(id, groupId, title, assignee, activate, due, now, now, user, description, category);
        return dto(db.prepare('SELECT * FROM tasks WHERE id=?').get(id) as TaskRow);
      });
    })
    .immediate();
}
export function withdrawLinked(db: Db, row: AlarmRequestRow, now: number): void {
  db.prepare(
    "UPDATE alarm_requests SET status='WITHDRAWN',withdrawn_at_epoch_ms=?,updated_at_epoch_ms=? WHERE id=?",
  ).run(now, now, row.id);
  db.prepare(
    "UPDATE alarm_recipients SET decision='NEEDS_REVIEW',decision_revision=decision_revision+1,accepted_request_version=NULL,consent_scope=NULL,chosen_time_zone=NULL,chosen_local_date=NULL,chosen_local_time=NULL,chosen_effective_at_epoch_ms=NULL,updated_at_epoch_ms=? WHERE request_id=? AND decision='ACCEPTED'",
  ).run(now, row.id);
  db.prepare(
    "UPDATE device_schedules SET status='CANCEL_PENDING',status_updated_at_epoch_ms=? WHERE request_id=? AND status IN ('SCHEDULED','SCHEDULING','PENDING_PERMISSION')",
  ).run(now, row.id);
  const updated = getAlarmRequest(db, row.id)!;
  for (const uid of new Set([row.creator_uid, ...getRecipientUids(db, row.id)])) {
    const recipient = getRecipient(db, row.id, uid);
    appendChangeEvent(db, {
      audienceUid: uid,
      groupId: row.group_id,
      entityType: 'alarm_request',
      entityId: row.id,
      entityVersion: row.request_version,
      kind: 'TOMBSTONE',
      payload: {
        request: { ...alarmRequestDto(updated), recipientUids: getRecipientUids(db, row.id) },
        recipient: recipient ? recipientDto(recipient) : null,
      },
      nowEpochMs: now,
    });
    enqueueOutboxEvent(db, {
      audienceUid: uid,
      groupId: row.group_id,
      kind: 'task.alarm_withdrawn',
      entityType: 'alarm_request',
      entityId: row.id,
      entityVersion: row.request_version,
      payload: { requestId: row.id, requestVersion: row.request_version },
      nowEpochMs: now,
    });
  }
}
export function updateTask(
  db: Db,
  user: string,
  groupId: string,
  taskId: string,
  raw: unknown,
  now = Date.now(),
): HouseholdTask {
  const data = asRecord(raw);
  assertNoExtraKeys(data, ['operationId', 'status', 'expectedVersion']);
  if (data.status !== 'pending' && data.status !== 'completed' && data.status !== 'cancelled')
    throw new DomainError('INVALID_ARGUMENT', 'Estado inválido.');
  const expected = readPositiveInt(data.expectedVersion, 'expectedVersion');
  return db
    .transaction(() => {
      requireActiveMembership(db, groupId, user);
      return operation(db, user, 'updateTask', { ...data, groupId, taskId }, now, () => {
        const row = db
          .prepare('SELECT * FROM tasks WHERE id=? AND group_id=?')
          .get(taskId, groupId) as TaskRow | undefined;
        if (!row) throw new DomainError('NOT_FOUND', 'Tarea no encontrada.');
        if (row.status.toLowerCase() === data.status) return dto(row);
        if (row.version !== expected) throw new DomainError('VERSION_CONFLICT', 'La tarea cambió.');
        if (data.status === 'pending' ? row.status !== 'COMPLETED' : row.status !== 'PENDING')
          throw new DomainError('INVALID_ARGUMENT', 'La tarea ya está cerrada.');
        db.prepare(
          'UPDATE tasks SET status=?,version=version+1,completed_by_uid=?,completed_at_epoch_ms=?,updated_at_epoch_ms=? WHERE id=?',
        ).run(
          String(data.status).toUpperCase(),
          data.status === 'completed' ? user : null,
          data.status === 'completed' ? now : null,
          now,
          taskId,
        );
        if (data.status !== 'pending') for (const alarm of db
          .prepare("SELECT * FROM alarm_requests WHERE task_id=? AND status='ACTIVE'")
          .all(taskId) as AlarmRequestRow[])
          withdrawLinked(db, alarm, now);
        return dto(db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId) as TaskRow);
      });
    })
    .immediate();
}
