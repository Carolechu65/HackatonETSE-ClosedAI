import { DomainError } from '../../../src/domain/errors.ts';
import { assertCanRespond, nextDecisionRevision } from '../../../src/domain/consent.ts';
import {
  parseCreateAlarmRequest,
  parseOperationEnvelope,
  parseReportSchedule,
  parseRespondToAlarm,
  parseWithdrawAlarmRequest,
} from '../../../src/domain/contracts/validate.ts';
import type {
  CreateAlarmRequest,
  OperationReceipt,
  ReportSchedule,
  RespondToAlarm,
  WithdrawAlarmRequest,
} from '../../../src/domain/contracts/types.ts';
import { occurrenceIdFromEpochMs } from '../../../src/domain/ids.ts';
import { isPast, isoWeekdayOf, nextWeeklyOccurrence, parseLocalDate } from '../../../src/domain/time.ts';
import type { AuthUser } from '../auth/service.ts';
import { isActiveMember, requireActiveMembership } from '../groups/service.ts';
import { canonicalJson, sha256Hex } from '../lib/crypto.ts';
import { generateId as newId } from '../lib/ids.ts';
import type { Db } from '../persistence/db.ts';
import { appendChangeEvent, enqueueOutboxEvent } from '../persistence/events.ts';
import {
  alarmRequestDto,
  getAlarmRequest,
  getRecipient,
  getRecipientUids,
  getSchedule,
  listRecipients,
  recipientDto,
  scheduleDto,
  withRecipientUids,
  type AlarmRequestRow,
  type RecipientRow,
} from './dto.ts';

export type OperationName =
  | 'createAlarmRequest'
  | 'respondToAlarm'
  | 'reportSchedule'
  | 'withdrawAlarmRequest';

const OPERATION_NAMES: readonly OperationName[] = [
  'createAlarmRequest',
  'respondToAlarm',
  'reportSchedule',
  'withdrawAlarmRequest',
];

export function isOperationName(value: string): value is OperationName {
  return (OPERATION_NAMES as readonly string[]).includes(value);
}

type StoredOperation = {
  operation_name: string;
  input_hash: string;
  result_json: string;
};

function receiptWith(
  operationId: string,
  nowEpochMs: number,
  fields: { requestVersion?: number; decisionRevision?: number; result?: Record<string, unknown> },
): OperationReceipt {
  const receipt: OperationReceipt = {
    operationId,
    status: 'APPLIED',
    serverTimeEpochMs: nowEpochMs,
  };
  if (fields.requestVersion !== undefined) receipt.requestVersion = fields.requestVersion;
  if (fields.decisionRevision !== undefined) receipt.decisionRevision = fields.decisionRevision;
  if (fields.result !== undefined) receipt.result = fields.result;
  return receipt;
}

function requireRequestRow(db: Db, requestId: string, groupId: string): AlarmRequestRow {
  const request = getAlarmRequest(db, requestId);
  if (!request || request.group_id !== groupId) {
    throw new DomainError('NOT_FOUND', 'Propuesta no encontrada.');
  }
  return request;
}

function emitRequestChange(
  db: Db,
  request: AlarmRequestRow,
  audiences: readonly string[],
  nowEpochMs: number,
): void {
  const recipientUids = getRecipientUids(db, request.id);
  const requestDto = withRecipientUids(alarmRequestDto(request), recipientUids);
  for (const audienceUid of new Set(audiences)) {
    const recipient = getRecipient(db, request.id, audienceUid);
    appendChangeEvent(db, {
      audienceUid,
      groupId: request.group_id,
      entityType: 'alarm_request',
      entityId: request.id,
      entityVersion: request.request_version,
      kind: request.status === 'ACTIVE' ? 'UPSERT' : 'TOMBSTONE',
      payload: {
        request: requestDto,
        recipient: recipient ? recipientDto(recipient) : null,
      },
      nowEpochMs,
    });
  }
}

function createAlarmRequest(
  db: Db,
  actor: AuthUser,
  command: CreateAlarmRequest,
  nowEpochMs: number,
): OperationReceipt {
  const { groupId, operationId, payload } = command;
  requireActiveMembership(db, groupId, actor.uid);

  for (const recipientUid of payload.recipientUids) {
    if (!isActiveMember(db, groupId, recipientUid)) {
      throw new DomainError('FORBIDDEN', 'Un destinatario no pertenece al piso.');
    }
  }
  if (payload.taskId !== undefined) {
    const task = db
      .prepare("SELECT 1 AS ok FROM tasks WHERE id = ? AND group_id = ? AND status='PENDING'")
      .get(payload.taskId, groupId);
    if (!task) throw new DomainError('NOT_FOUND', 'Tarea no encontrada en el piso.');
  }
  if (payload.recurrence !== undefined && payload.recurrence.localTime !== payload.timeSpec.localTime) {
    throw new DomainError('INVALID_ARGUMENT', 'payload.recurrence.localTime debe coincidir con el primer aviso.');
  }
  if (payload.recurrence !== undefined) {
    const firstDate = parseLocalDate(payload.timeSpec.localDate);
    if (!firstDate || isoWeekdayOf(firstDate) !== payload.recurrence.isoWeekday) {
      throw new DomainError('INVALID_ARGUMENT', 'payload.recurrence.isoWeekday debe coincidir con la fecha del primer aviso.');
    }
  }

  const requestId = newId('req');
  db.prepare(
    `INSERT INTO alarm_requests
      (id, group_id, creator_uid, title, note, task_id, request_version, status,
       time_zone, local_date, local_time, effective_at_epoch_ms, mode,
       recurrence_kind, recurrence_weekday, recurrence_local_time, recurrence_until_epoch_ms,
       created_at_epoch_ms, updated_at_epoch_ms)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    requestId,
    groupId,
    actor.uid,
    payload.title,
    payload.note ?? null,
    payload.taskId ?? null,
    payload.timeSpec.timeZone,
    payload.timeSpec.localDate,
    payload.timeSpec.localTime,
    payload.timeSpec.effectiveAtEpochMs,
    payload.mode,
    payload.recurrence?.kind ?? null,
    payload.recurrence?.isoWeekday ?? null,
    payload.recurrence?.localTime ?? null,
    payload.recurrence?.untilEpochMs ?? null,
    nowEpochMs,
    nowEpochMs,
  );

  const insertRecipient = db.prepare(
    `INSERT INTO alarm_recipients
      (request_id, uid, received_version, reception, decision, decision_revision, updated_at_epoch_ms)
     VALUES (?, ?, 1, 'NOT_ACKNOWLEDGED', 'PENDING', 1, ?)`,
  );
  for (const recipientUid of payload.recipientUids) insertRecipient.run(requestId, recipientUid, nowEpochMs);

  const request = getAlarmRequest(db, requestId);
  if (!request) throw new Error('La propuesta no se guardó.');
  emitRequestChange(db, request, [actor.uid, ...payload.recipientUids], nowEpochMs);

  for (const recipientUid of payload.recipientUids) {
    enqueueOutboxEvent(db, {
      audienceUid: recipientUid,
      groupId,
      kind: 'alarm_request.created',
      entityType: 'alarm_request',
      entityId: requestId,
      entityVersion: 1,
      payload: { groupId, requestId, requestVersion: 1 },
      nowEpochMs,
    });
  }

  return receiptWith(operationId, nowEpochMs, { requestVersion: 1, result: { requestId } });
}

function respondToAlarm(
  db: Db,
  actor: AuthUser,
  command: RespondToAlarm,
  nowEpochMs: number,
): OperationReceipt {
  const { groupId, operationId, entityId, payload } = command;
  if (!entityId) throw new DomainError('INVALID_ARGUMENT', 'entityId: obligatorio.');
  requireActiveMembership(db, groupId, actor.uid);
  const request = requireRequestRow(db, entityId, groupId);
  const recipient = getRecipient(db, request.id, actor.uid);
  if (!recipient) {
    throw new DomainError('FORBIDDEN', 'Solo un destinatario decide sobre su aviso.');
  }
  if (request.status === 'ACTIVE' && isPast(request.effective_at_epoch_ms, nowEpochMs)) {
    db.prepare("UPDATE alarm_requests SET status = 'EXPIRED', expired_at_epoch_ms = ?, updated_at_epoch_ms = ? WHERE id = ?")
      .run(nowEpochMs, nowEpochMs, request.id);
    throw new DomainError('EXPIRED', 'La propuesta ya pasó y no se puede activar en diferido.');
  }
  assertCanRespond({
    actorUid: actor.uid,
    creatorUid: request.creator_uid,
    recipientUid: recipient.uid,
    memberActive: true,
    proposalStatus: request.status,
    expectedRequestVersion: command.expectedRequestVersion ?? 0,
    currentRequestVersion: request.request_version,
    expectedDecisionRevision: command.expectedDecisionRevision ?? 0,
    currentDecisionRevision: recipient.decision_revision,
    from: recipient.decision,
    to: payload.decision,
  });

  if (payload.decision === 'ACCEPTED' && payload.consentScope === 'SERIES'
    && request.recurrence_kind !== 'WEEKLY') {
    throw new DomainError('INVALID_ARGUMENT', 'SERIES exige una propuesta con recurrencia semanal.');
  }
  const revision = nextDecisionRevision(recipient.decision_revision);
  const accepted = payload.decision === 'ACCEPTED';
  db.prepare(
    `UPDATE alarm_recipients SET
      reception='RECEIVED',received_version=?,decision = ?, decision_revision = ?, accepted_request_version = ?, consent_scope = ?,
      chosen_time_zone = ?, chosen_local_date = ?, chosen_local_time = ?, chosen_effective_at_epoch_ms = ?,
      reason = ?, updated_at_epoch_ms = ?
     WHERE request_id = ? AND uid = ?`,
  ).run(
    request.request_version,
    payload.decision,
    revision,
    accepted ? request.request_version : null,
    accepted ? payload.consentScope ?? null : null,
    accepted ? payload.chosenTimeSpec?.timeZone ?? null : null,
    accepted ? payload.chosenTimeSpec?.localDate ?? null : null,
    accepted ? payload.chosenTimeSpec?.localTime ?? null : null,
    accepted ? payload.chosenTimeSpec?.effectiveAtEpochMs ?? null : null,
    payload.reason ?? null,
    nowEpochMs,
    request.id,
    actor.uid,
  );

  emitRequestChange(db, request, [actor.uid, request.creator_uid], nowEpochMs);
  enqueueOutboxEvent(db, {
    audienceUid: request.creator_uid,
    groupId,
    kind: 'alarm_recipient.responded',
    entityType: 'recipient',
    entityId: `${request.id}:${actor.uid}`,
    entityVersion: revision,
    payload: { groupId, requestId: request.id, uid: actor.uid, decisionRevision: revision },
    nowEpochMs,
  });

  return receiptWith(operationId, nowEpochMs, {
    requestVersion: request.request_version,
    decisionRevision: revision,
    result: { requestId: request.id, decision: payload.decision },
  });
}

function withdrawAlarmRequest(
  db: Db,
  actor: AuthUser,
  command: WithdrawAlarmRequest,
  nowEpochMs: number,
): OperationReceipt {
  const { groupId, operationId, entityId, payload } = command;
  if (!entityId) throw new DomainError('INVALID_ARGUMENT', 'entityId: obligatorio.');
  requireActiveMembership(db, groupId, actor.uid);
  const request = requireRequestRow(db, entityId, groupId);
  if (request.creator_uid !== actor.uid) {
    throw new DomainError('FORBIDDEN', 'Solo quien propuso el aviso puede retirarlo.');
  }
  if (request.status !== 'ACTIVE') {
    throw new DomainError('EXPIRED', 'La propuesta ya no está activa.');
  }
  if (command.expectedRequestVersion !== request.request_version) {
    throw new DomainError('VERSION_CONFLICT', 'La propuesta cambió: vuelve a cargarla.', {
      expectedRequestVersion: command.expectedRequestVersion,
      currentRequestVersion: request.request_version,
    });
  }

  db.prepare(
    "UPDATE alarm_requests SET status = 'WITHDRAWN', withdrawn_at_epoch_ms = ?, updated_at_epoch_ms = ? WHERE id = ?",
  ).run(nowEpochMs, nowEpochMs, request.id);

  const recipients = listRecipients(db, request.id);
  for (const recipient of recipients) {
    if (recipient.decision === 'ACCEPTED') {
      db.prepare(
        "UPDATE alarm_recipients SET decision = 'NEEDS_REVIEW', decision_revision = ?, accepted_request_version = NULL, consent_scope=NULL,chosen_time_zone=NULL,chosen_local_date=NULL,chosen_local_time=NULL,chosen_effective_at_epoch_ms=NULL, updated_at_epoch_ms = ? WHERE request_id = ? AND uid = ?",
      ).run(nextDecisionRevision(recipient.decision_revision), nowEpochMs, request.id, recipient.uid);
    }
  }

  db.prepare("UPDATE device_schedules SET status='CANCEL_PENDING',status_updated_at_epoch_ms=? WHERE request_id=? AND status IN ('SCHEDULED','SCHEDULING','PENDING_PERMISSION')").run(nowEpochMs,request.id);
  const updated = getAlarmRequest(db, request.id);
  if (!updated) throw new Error('La propuesta no se guardó.');
  const audiences = [actor.uid, ...recipients.map((recipient) => recipient.uid)];
  emitRequestChange(db, updated, audiences, nowEpochMs);
  for (const recipient of recipients) {
    enqueueOutboxEvent(db, {
      audienceUid: recipient.uid,
      groupId,
      kind: 'alarm_request.withdrawn',
      entityType: 'alarm_request',
      entityId: request.id,
      entityVersion: updated.request_version,
      payload: { groupId, requestId: request.id, requestVersion: updated.request_version, reason: payload.reason },
      nowEpochMs,
    });
  }

  return receiptWith(operationId, nowEpochMs, {
    requestVersion: updated.request_version,
    result: { requestId: updated.id, status: 'WITHDRAWN' },
  });
}

function reportSchedule(
  db: Db,
  actor: AuthUser,
  command: ReportSchedule,
  nowEpochMs: number,
): OperationReceipt {
  const { groupId, operationId, entityId, payload } = command;
  if (!entityId) throw new DomainError('INVALID_ARGUMENT', 'entityId: obligatorio.');
  requireActiveMembership(db, groupId, actor.uid);
  const request = requireRequestRow(db, entityId, groupId);
  const recipient = getRecipient(db, request.id, actor.uid);
  if (!recipient) throw new DomainError('FORBIDDEN', 'Solo el destinatario reporta su programación.');

  const cancellation=payload.status==='CANCELLED'||payload.status==='CANCEL_PENDING';
  if (!cancellation && request.status !== 'ACTIVE') throw new DomainError('EXPIRED', 'La propuesta ya no está activa.');
  if (payload.requestVersion !== request.request_version) {
    throw new DomainError('VERSION_CONFLICT', 'La propuesta cambió: no revivas una decisión antigua.', {
      expectedRequestVersion: payload.requestVersion,
      currentRequestVersion: request.request_version,
    });
  }
  if (payload.decisionRevision !== recipient.decision_revision || (!cancellation && (recipient.decision !== 'ACCEPTED'
    || recipient.accepted_request_version !== request.request_version))) {
    throw new DomainError('VERSION_CONFLICT', 'El consentimiento vigente no coincide con el acuse.', {
      decisionRevision: recipient.decision_revision,
      decision: recipient.decision,
    });
  }
  if (payload.mode !== request.mode) {
    throw new DomainError('INVALID_ARGUMENT', 'payload.mode no coincide con la modalidad aceptada.');
  }
  if (payload.reportedAtEpochMs > nowEpochMs + 5 * 60 * 1000) {
    throw new DomainError('INVALID_ARGUMENT', 'payload.reportedAtEpochMs no puede estar en el futuro.');
  }

  const consentTime = recipient.chosen_effective_at_epoch_ms ?? request.effective_at_epoch_ms;
  const recurrence=alarmRequestDto(request).recurrence;
  const seriesOccurrence = recurrence && recipient.consent_scope === 'SERIES'
    && payload.effectiveAtEpochMs > consentTime
    && nextWeeklyOccurrence(
      { ...recurrence, localTime: recipient.chosen_local_time ?? request.local_time },
      recipient.chosen_time_zone ?? request.time_zone,
      payload.effectiveAtEpochMs - 1,
    ) === payload.effectiveAtEpochMs;
  if (!cancellation && payload.effectiveAtEpochMs !== consentTime && !seriesOccurrence) {
    throw new DomainError('INVALID_ARGUMENT', 'payload.effectiveAtEpochMs no coincide con el horario consentido.', {
      expectedEffectiveAtEpochMs: consentTime,
    });
  }
  if (payload.occurrenceId !== occurrenceIdFromEpochMs(payload.effectiveAtEpochMs)) {
    throw new DomainError('INVALID_ARGUMENT', 'payload.occurrenceId no corresponde al instante consentido.');
  }

  const user = db.prepare('SELECT primary_device_id, device_epoch FROM users WHERE id = ?').get(actor.uid) as {
    primary_device_id: string | null;
    device_epoch: number;
  };
  const device = db
    .prepare("SELECT 1 AS ok FROM devices WHERE id = ? AND user_id = ? AND status = 'ACTIVE'")
    .get(payload.deviceId, actor.uid);
  if (!device || user.primary_device_id !== payload.deviceId || user.device_epoch !== payload.deviceEpoch) {
    throw new DomainError('DEVICE_NOT_PRIMARY', 'El acuse debe venir del dispositivo principal vigente.', {
      deviceEpoch: user.device_epoch,
    });
  }

  const existing = getSchedule(
    db,
    request.id,
    actor.uid,
    payload.occurrenceId,
    payload.deviceId,
    payload.deviceEpoch,
  );
  const terminal = new Set(['CANCELLED', 'EXPIRED', 'FAILED', 'FIRED']);
  const sameRevision = existing?.request_version === payload.requestVersion
    && existing.decision_revision === payload.decisionRevision;
  if (existing && sameRevision && (
    (['CANCELLED', 'EXPIRED', 'FIRED'].includes(existing.status) && payload.status !== existing.status)
    || (terminal.has(existing.status) && payload.reportedAtEpochMs <= existing.status_updated_at_epoch_ms)
    || payload.reportedAtEpochMs < existing.reported_at_epoch_ms
  )) {
    return receiptWith(operationId, nowEpochMs, {
      requestVersion: request.request_version,
      decisionRevision: recipient.decision_revision,
      result: {
        requestId: request.id,
        occurrenceId: payload.occurrenceId,
        status: existing.status,
        ignored: true,
      },
    });
  }

  if (existing) {
    db.prepare(
      `UPDATE device_schedules SET request_version=?,decision_revision=?,status = ?, reported_at_epoch_ms = ?, status_updated_at_epoch_ms = ?, reason = ?,
         mode = ?, mechanism = ?, effective_at_epoch_ms = ?
       WHERE request_id = ? AND uid = ? AND occurrence_id = ? AND device_id = ? AND device_epoch = ?`,
    ).run(
      payload.requestVersion,
      payload.decisionRevision,
      payload.status,
      payload.reportedAtEpochMs,
      payload.reportedAtEpochMs,
      payload.reason ?? null,
      payload.mode,
      payload.mechanism,
      payload.effectiveAtEpochMs,
      request.id,
      actor.uid,
      payload.occurrenceId,
      payload.deviceId,
      payload.deviceEpoch,
    );
  } else {
    db.prepare(
      `INSERT INTO device_schedules
        (request_id, uid, occurrence_id, device_id, device_epoch, request_version, decision_revision,
         mode, mechanism, status, effective_at_epoch_ms, reported_at_epoch_ms, status_updated_at_epoch_ms, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      request.id,
      actor.uid,
      payload.occurrenceId,
      payload.deviceId,
      payload.deviceEpoch,
      payload.requestVersion,
      payload.decisionRevision,
      payload.mode,
      payload.mechanism,
      payload.status,
      payload.effectiveAtEpochMs,
      payload.reportedAtEpochMs,
      payload.reportedAtEpochMs,
      payload.reason ?? null,
    );
  }

  const schedule = getSchedule(
    db,
    request.id,
    actor.uid,
    payload.occurrenceId,
    payload.deviceId,
    payload.deviceEpoch,
  );
  if (!schedule) throw new Error('El acuse no se guardó.');
  const schedulePayload = scheduleDto(schedule);
  for (const audienceUid of new Set([actor.uid, request.creator_uid])) {
    appendChangeEvent(db, {
      audienceUid,
      groupId,
      entityType: 'schedule',
      entityId: `${request.id}:${actor.uid}:${payload.occurrenceId}`,
      entityVersion: schedule.status_updated_at_epoch_ms,
      kind: 'UPSERT',
      payload: { requestId: request.id, uid: actor.uid, schedule: schedulePayload },
      nowEpochMs,
    });
  }
  enqueueOutboxEvent(db, {
    audienceUid: request.creator_uid,
    groupId,
    kind: 'schedule.reported',
    entityType: 'schedule',
    entityId: `${request.id}:${actor.uid}:${payload.occurrenceId}`,
    entityVersion: schedule.status_updated_at_epoch_ms,
    payload: {
      groupId,
      requestId: request.id,
      uid: actor.uid,
      occurrenceId: payload.occurrenceId,
      status: payload.status,
    },
    nowEpochMs,
  });

  return receiptWith(operationId, nowEpochMs, {
    requestVersion: request.request_version,
    decisionRevision: recipient.decision_revision,
    result: {
      requestId: request.id,
      occurrenceId: payload.occurrenceId,
      status: payload.status,
    },
  });
}

function parseForName(name: OperationName, body: unknown, nowEpochMs: number):
  | CreateAlarmRequest
  | RespondToAlarm
  | ReportSchedule
  | WithdrawAlarmRequest {
  switch (name) {
    case 'createAlarmRequest':
      return parseCreateAlarmRequest(body, { nowEpochMs });
    case 'respondToAlarm':
      return parseRespondToAlarm(body, { nowEpochMs });
    case 'reportSchedule':
      return parseReportSchedule(body);
    case 'withdrawAlarmRequest':
      return parseWithdrawAlarmRequest(body);
  }
}

function assertReplayAuthorized(
  db: Db,
  actor: AuthUser,
  name: OperationName,
  groupId: string,
  entityId: string | undefined,
): void {
  if (!isActiveMember(db, groupId, actor.uid)) {
    throw new DomainError('NOT_FOUND', 'Grupo no encontrado.');
  }
  if ((name === 'respondToAlarm' || name === 'reportSchedule') && entityId) {
    if (!getRecipient(db, entityId, actor.uid)) {
      throw new DomainError('FORBIDDEN', 'Solo el destinatario accede a esta propuesta.');
    }
  }
  if (name === 'withdrawAlarmRequest' && entityId) {
    const request = getAlarmRequest(db, entityId);
    if (!request || request.creator_uid !== actor.uid) {
      throw new DomainError('FORBIDDEN', 'Solo quien propuso el aviso puede retirarlo.');
    }
  }
}

export function executeOperation(
  db: Db,
  actor: AuthUser,
  name: OperationName,
  body: unknown,
  nowEpochMs = Date.now(),
): OperationReceipt {
  const envelope = parseOperationEnvelope(body);
  const inputHash = sha256Hex(canonicalJson({ operation: name, body }));

  const existing = db
    .prepare('SELECT operation_name, input_hash, result_json FROM operations WHERE actor_uid = ? AND operation_id = ?')
    .get(actor.uid, envelope.operationId) as StoredOperation | undefined;

  if (existing) {
    if (existing.operation_name !== name || existing.input_hash !== inputHash) {
      throw new DomainError('VERSION_CONFLICT', 'operationId reutilizado con otra operación o contenido.');
    }
    assertReplayAuthorized(db, actor, name, envelope.groupId, envelope.entityId);
    const stored = JSON.parse(existing.result_json) as OperationReceipt;
    return { ...stored, status: 'REPLAYED', serverTimeEpochMs: nowEpochMs };
  }

  const command = parseForName(name, body, nowEpochMs);

  const apply = db.transaction((): OperationReceipt => {
    const receipt = (() => {
      switch (name) {
        case 'createAlarmRequest':
          return createAlarmRequest(db, actor, command as CreateAlarmRequest, nowEpochMs);
        case 'respondToAlarm':
          return respondToAlarm(db, actor, command as RespondToAlarm, nowEpochMs);
        case 'reportSchedule':
          return reportSchedule(db, actor, command as ReportSchedule, nowEpochMs);
        case 'withdrawAlarmRequest':
          return withdrawAlarmRequest(db, actor, command as WithdrawAlarmRequest, nowEpochMs);
      }
    })();
    db.prepare(
      `INSERT INTO operations (actor_uid, operation_id, operation_name, input_hash, result_json, created_at_epoch_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(actor.uid, envelope.operationId, name, inputHash, JSON.stringify(receipt), nowEpochMs);
    return receipt;
  });
  return apply.immediate();
}

export { getAlarmRequest, getRecipient, listRecipients, alarmRequestDto, withRecipientUids, recipientDto };
