import type { Db } from '../persistence/db.ts';
import type { AuthUser } from '../auth/service.ts';
import { executeOperation } from '../operations/execute.ts';
import { createTask } from './service.ts';
import { asRecord, readIdentifier } from '../lib/validation.ts';
import { sha256Hex } from '../lib/crypto.ts';
import { DomainError } from '../../../src/domain/errors.ts';

/** Both records commit together; a retry cannot leave an orphan task or duplicate alarm. */
export function createTaskAlarm(db: Db, actor: AuthUser, raw: unknown, now = Date.now()) {
  const envelope = asRecord(raw);
  const groupId = readIdentifier(envelope.groupId, 'groupId');
  const operationId = readIdentifier(envelope.operationId, 'operationId');
  const payload = asRecord(envelope.payload);
  if (payload.taskId !== undefined) throw new DomainError('INVALID_ARGUMENT', 'Este aviso ya tiene una tarea asociada.');
  const recipients = Array.isArray(payload.recipientUids) ? payload.recipientUids : [];
  const timeSpec = asRecord(payload.timeSpec);
  return db.transaction(() => {
    const task = createTask(db, actor.uid, groupId, {
      operationId: `alarm-task-${sha256Hex(operationId)}`, title: payload.title, description: payload.note ?? null,
      assigneeUid: recipients.length === 1 ? recipients[0] : null,
      activateAtEpochMs: null, dueAtEpochMs: timeSpec.effectiveAtEpochMs,
    }, now);
    return executeOperation(db, actor, 'createAlarmRequest', { ...envelope, payload: { ...payload, taskId: task.id } }, now);
  }).immediate();
}
