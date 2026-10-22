import type { Db } from "../persistence/database.ts";
import {
  canonical,
  DomainError,
  event,
  hash,
  id,
  member,
} from "../app/support.ts";
import {
  parseOperation,
  type OperationName,
} from "../../../src/domain/contracts/validate.ts";
import type {
  AlarmRequestDocument,
  RecipientDocument,
  ScheduleDocument,
  OperationReceipt,
  CreateAlarmRequest,
  RespondToAlarm,
  ReportSchedule,
} from "../../../src/domain/contracts/types.ts";
import {
  assertCanRespond,
  hasCurrentConsent,
} from "../../../src/domain/consent.ts";
import { nextWeeklyOccurrence } from "../../../src/domain/time.ts";
// SQL rows are internal only; converters explicitly select public fields.
type Row = Record<string, any>;
export type AlarmRecord = {
  groupId: string;
  requestId: string;
  request: AlarmRequestDocument;
  recipient: RecipientDocument;
  primaryDevice: { deviceId: string; deviceEpoch: number } | null;
  schedules: ScheduleDocument[];
};
export function requestRow(
  db: Db,
  user: string,
  group: string,
  request: string,
): Row {
  member(db, user, group);
  const row = db
    .prepare("SELECT * FROM alarm_requests WHERE id=? AND group_id=?")
    .get(request, group) as Row | undefined;
  if (
    !row ||
    !(
      row.creator_uid === user ||
      db
        .prepare(
          "SELECT 1 FROM alarm_recipients WHERE request_id=? AND recipient_uid=?",
        )
        .get(request, user)
    )
  )
    throw new DomainError("NOT_FOUND", "Propuesta no disponible.");
  return row;
}
export function alarmRecord(
  db: Db,
  user: string,
  group: string,
  request: string,
  recipientUid = user,
): AlarmRecord {
  const row = requestRow(db, user, group, request);
  if (user !== recipientUid && row.creator_uid !== user)
    throw new DomainError("FORBIDDEN", "Destinatario no autorizado.");
  const rec = db
    .prepare(
      "SELECT * FROM alarm_recipients WHERE request_id=? AND recipient_uid=?",
    )
    .get(request, recipientUid) as Row | undefined;
  if (!rec) throw new DomainError("NOT_FOUND", "Destinatario no disponible.");
  const document: AlarmRequestDocument = {
    creatorUid: row.creator_uid,
    title: row.title,
    recipientUids: (
      db
        .prepare(
          "SELECT recipient_uid FROM alarm_recipients WHERE request_id=?",
        )
        .all(request) as Row[]
    ).map((r) => r.recipient_uid),
    requestVersion: row.request_version,
    status: row.status,
    timeSpec: JSON.parse(row.time_spec),
    mode: row.mode,
    createdAtEpochMs: row.created_at,
    updatedAtEpochMs: row.updated_at,
  };
  if (row.note !== null) document.note = row.note;
  if (row.task_id !== null) document.taskId = row.task_id;
  if (row.recurrence !== null) document.recurrence = JSON.parse(row.recurrence);
  if (row.withdrawn_at !== null) document.withdrawnAtEpochMs = row.withdrawn_at;
  const recipient: RecipientDocument = {
    uid: rec.recipient_uid,
    receivedVersion: rec.received_version,
    reception: rec.reception,
    decision: rec.decision,
    decisionRevision: rec.decision_revision,
    updatedAtEpochMs: rec.updated_at,
  };
  if (rec.accepted_request_version !== null)
    recipient.acceptedRequestVersion = rec.accepted_request_version;
  if (rec.chosen_time_spec !== null)
    recipient.chosenTimeSpec = JSON.parse(rec.chosen_time_spec);
  if (rec.consent_scope !== null) recipient.consentScope = rec.consent_scope;
  if (rec.reason !== null) recipient.reason = rec.reason;
  const device = db
    .prepare("SELECT primary_device_id,device_epoch FROM users WHERE id=?")
    .get(recipientUid) as Row;
  const schedules = (
    db
      .prepare(
        "SELECT * FROM device_schedules WHERE request_id=? AND recipient_uid=? ORDER BY updated_at DESC LIMIT 128",
      )
      .all(request, recipientUid) as Row[]
  ).map((r) => ({
    occurrenceId: r.occurrence_id,
    deviceId: r.device_id,
    deviceEpoch: r.device_epoch,
    requestVersion: r.request_version,
    decisionRevision: r.decision_revision,
    mode: r.mode,
    mechanism: r.mechanism,
    status: r.status,
    effectiveAtEpochMs: r.effective_at,
    reportedAtEpochMs: r.reported_at,
    statusUpdatedAtEpochMs: r.updated_at,
    ...(r.reason ? { reason: r.reason } : {}),
  }));
  return {
    groupId: group,
    requestId: request,
    request: document,
    recipient,
    primaryDevice: device.primary_device_id
      ? { deviceId: device.primary_device_id, deviceEpoch: device.device_epoch }
      : null,
    schedules,
  };
}
export function notifyRequest(
  db: Db,
  row: Row,
  now: number,
  push = true,
): void {
  for (const rec of db
    .prepare("SELECT recipient_uid FROM alarm_recipients WHERE request_id=?")
    .all(row.id) as Row[]) {
    event(db, rec.recipient_uid, row.group_id, row.id, "upsert", now);
    if (push)
      db.prepare(
        "INSERT INTO outbox_events(id,user_id,request_id,request_version,available_at) VALUES (?,?,?,?,?)",
      ).run(id(), rec.recipient_uid, row.id, row.request_version, now);
  }
}
export function withdraw(db: Db, row: Row, now: number): void {
  if (row.status !== "ACTIVE") return;
  db.prepare(
    "UPDATE alarm_requests SET status='WITHDRAWN',request_version=request_version+1,updated_at=?,withdrawn_at=? WHERE id=?",
  ).run(now, now, row.id);
  db.prepare(
    "UPDATE device_schedules SET status='CANCEL_PENDING',updated_at=? WHERE request_id=? AND status IN ('SCHEDULED','SCHEDULING','PENDING_PERMISSION')",
  ).run(now, row.id);
  notifyRequest(db, { ...row, request_version: row.request_version + 1 }, now);
}
export function execute(
  db: Db,
  user: string,
  name: OperationName,
  raw: unknown,
  now: number,
): OperationReceipt {
  // Structural validation precedes replay; time validity is checked only for a new effect.
  const command = parseOperation(name, raw);
  const digest = hash(canonical({ name, command }));
  return db.transaction(() => {
    member(db, user, command.groupId);
    if (name !== "createAlarmRequest")
      requestRow(db, user, command.groupId, command.entityId!);
    const previous = db
      .prepare("SELECT * FROM operations WHERE actor_uid=? AND operation_id=?")
      .get(user, command.operationId) as Row | undefined;
    if (previous) {
      if (previous.payload_hash !== digest || previous.kind !== name)
        throw new DomainError(
          "VERSION_CONFLICT",
          "operationId ya utilizado con otra entrada.",
        );
      const old = JSON.parse(previous.receipt) as OperationReceipt;
      if (name === "createAlarmRequest")
        requestRow(db, user, command.groupId, String(old.result?.requestId));
      return { ...old, status: "REPLAYED" as const };
    }
    parseOperation(name, raw, { nowEpochMs: now });
    let requestVersion: number, decisionRevision: number | undefined;
    let requestId = command.entityId ?? id();
    if (name === "createAlarmRequest") {
      const payload = (command as CreateAlarmRequest).payload;
      if (payload.recipientUids.includes(user))
        throw new DomainError(
          "INVALID_ARGUMENT",
          "Selecciona a otra persona como destinataria.",
        );
      for (const uid of payload.recipientUids) member(db, uid, command.groupId);
      const group = db
        .prepare("SELECT time_zone FROM groups WHERE id=?")
        .get(command.groupId) as Row;
      if (payload.timeSpec.timeZone !== group.time_zone)
        throw new DomainError(
          "INVALID_ARGUMENT",
          "Usa la zona horaria del piso.",
        );
      if (
        payload.taskId &&
        !db
          .prepare(
            "SELECT 1 FROM tasks WHERE id=? AND group_id=? AND status='pending'",
          )
          .get(payload.taskId, command.groupId)
      )
        throw new DomainError("NOT_FOUND", "Tarea no disponible.");
      if (db.prepare("SELECT 1 FROM alarm_requests WHERE id=?").get(requestId))
        throw new DomainError("VERSION_CONFLICT", "La propuesta ya existe.");
      db.prepare(
        "INSERT INTO alarm_requests(id,group_id,creator_uid,title,note,task_id,request_version,status,mode,time_spec,recurrence,created_at,updated_at) VALUES (?,?,?,?,?,?,1,'ACTIVE',?,?,?,?,?)",
      ).run(
        requestId,
        command.groupId,
        user,
        payload.title,
        payload.note ?? null,
        payload.taskId ?? null,
        payload.mode,
        JSON.stringify(payload.timeSpec),
        payload.recurrence ? JSON.stringify(payload.recurrence) : null,
        now,
        now,
      );
      for (const uid of payload.recipientUids)
        db.prepare(
          "INSERT INTO alarm_recipients(request_id,recipient_uid,received_version,reception,decision,decision_revision,updated_at) VALUES (?,?,1,'NOT_ACKNOWLEDGED','PENDING',1,?)",
        ).run(requestId, uid, now);
      requestVersion = 1;
    } else {
      const row = requestRow(db, user, command.groupId, requestId);
      requestVersion = row.request_version;
      if (name === "withdrawAlarmRequest") {
        if (row.creator_uid !== user)
          throw new DomainError(
            "FORBIDDEN",
            "Solo quien propone puede retirar.",
          );
        if (command.expectedRequestVersion !== requestVersion)
          throw new DomainError("VERSION_CONFLICT", "La propuesta cambió.");
        if (row.status !== "ACTIVE")
          throw new DomainError("EXPIRED", "Propuesta ya retirada.");
        withdraw(db, row, now);
        requestVersion++;
      } else {
        const record = alarmRecord(db, user, command.groupId, requestId);
        const rec = record.recipient;
        if (name === "respondToAlarm") {
          const payload = (command as RespondToAlarm).payload;
          assertCanRespond({
            actorUid: user,
            creatorUid: row.creator_uid,
            recipientUid: rec.uid,
            memberActive: true,
            proposalStatus: row.status,
            expectedRequestVersion: command.expectedRequestVersion!,
            currentRequestVersion: requestVersion,
            expectedDecisionRevision: command.expectedDecisionRevision!,
            currentDecisionRevision: rec.decisionRevision,
            from: rec.decision,
            to: payload.decision,
          });
          if (
            payload.decision === "ACCEPTED" &&
            (payload.chosenTimeSpec ?? record.request.timeSpec)
              .effectiveAtEpochMs <= now
          )
            throw new DomainError("EXPIRED", "Elige una hora futura.");
          if (
            payload.chosenTimeSpec &&
            payload.chosenTimeSpec.timeZone !== record.request.timeSpec.timeZone
          )
            throw new DomainError(
              "INVALID_ARGUMENT",
              "Usa la zona horaria del piso.",
            );
          decisionRevision = rec.decisionRevision + 1;
          db.prepare(
            "UPDATE alarm_recipients SET reception='RECEIVED',received_version=?,decision=?,decision_revision=?,accepted_request_version=?,chosen_time_spec=?,consent_scope=?,reason=?,updated_at=? WHERE request_id=? AND recipient_uid=?",
          ).run(
            requestVersion,
            payload.decision,
            decisionRevision,
            payload.decision === "ACCEPTED" ? requestVersion : null,
            payload.chosenTimeSpec
              ? JSON.stringify(payload.chosenTimeSpec)
              : null,
            payload.consentScope ?? null,
            payload.reason ?? null,
            now,
            requestId,
            user,
          );
          db.prepare(
            "UPDATE device_schedules SET status='CANCEL_PENDING',updated_at=? WHERE request_id=? AND recipient_uid=? AND status IN ('SCHEDULED','SCHEDULING','PENDING_PERMISSION')",
          ).run(now, requestId, user);
        } else {
          const p = (command as ReportSchedule).payload;
          decisionRevision = rec.decisionRevision;
          if (
            !record.primaryDevice ||
            record.primaryDevice.deviceId !== p.deviceId ||
            record.primaryDevice.deviceEpoch !== p.deviceEpoch
          )
            throw new DomainError(
              "DEVICE_NOT_PRIMARY",
              "Dispositivo o epoch no vigente.",
            );
          if (
            p.requestVersion !== requestVersion ||
            p.decisionRevision !== decisionRevision
          )
            throw new DomainError(
              "VERSION_CONFLICT",
              "El acuse corresponde a versiones antiguas.",
            );
          const cancellation = ["CANCELLED", "CANCEL_PENDING"].includes(
            p.status,
          );
          if (
            !cancellation &&
            (row.status !== "ACTIVE" ||
              !hasCurrentConsent({ ...rec, requestVersion }))
          )
            throw new DomainError(
              "FORBIDDEN",
              "El acuse no tiene consentimiento vigente.",
            );
          if (
            p.mode !== row.mode ||
            p.occurrenceId !== `occ-${p.effectiveAtEpochMs}` ||
            p.reportedAtEpochMs > now + 300000
          )
            throw new DomainError(
              "INVALID_ARGUMENT",
              "Identidad o fecha del acuse inválida.",
            );
          const expected = (rec.chosenTimeSpec ?? record.request.timeSpec)
            .effectiveAtEpochMs;
          if (
            !cancellation &&
            p.effectiveAtEpochMs !== expected &&
            !(
              record.request.recurrence &&
              rec.consentScope === "SERIES" &&
              p.effectiveAtEpochMs > expected &&
              nextWeeklyOccurrence(
                record.request.recurrence,
                record.request.timeSpec.timeZone,
                p.effectiveAtEpochMs - 1,
              ) === p.effectiveAtEpochMs
            )
          )
            throw new DomainError(
              "INVALID_ARGUMENT",
              "La ocurrencia no está consentida.",
            );
          const prior = db
            .prepare(
              "SELECT status,reported_at FROM device_schedules WHERE request_id=? AND recipient_uid=? AND occurrence_id=? AND device_id=? AND device_epoch=?",
            )
            .get(requestId, user, p.occurrenceId, p.deviceId, p.deviceEpoch) as
            Row | undefined;
          if (
            prior &&
            (p.reportedAtEpochMs < prior.reported_at ||
              (["CANCELLED", "FIRED", "EXPIRED"].includes(prior.status) &&
                p.status !== prior.status))
          )
            throw new DomainError("VERSION_CONFLICT", "Acuse obsoleto.");
          db.prepare(
            "INSERT INTO device_schedules VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(request_id,recipient_uid,occurrence_id,device_id,device_epoch) DO UPDATE SET request_version=excluded.request_version,decision_revision=excluded.decision_revision,status=excluded.status,reported_at=excluded.reported_at,reason=excluded.reason,updated_at=excluded.updated_at",
          ).run(
            requestId,
            user,
            p.occurrenceId,
            p.deviceId,
            p.deviceEpoch,
            p.requestVersion,
            p.decisionRevision,
            p.mode,
            p.mechanism,
            p.status,
            p.effectiveAtEpochMs,
            p.reportedAtEpochMs,
            p.reason ?? null,
            now,
          );
        }
      }
    }
    if (name !== "withdrawAlarmRequest")
      notifyRequest(
        db,
        {
          id: requestId,
          group_id: command.groupId,
          request_version: requestVersion,
        },
        now,
        name !== "reportSchedule",
      );
    const receipt: OperationReceipt = {
      operationId: command.operationId,
      status: "APPLIED",
      serverTimeEpochMs: now,
      requestVersion,
      ...(decisionRevision ? { decisionRevision } : {}),
      result: { requestId },
    };
    db.prepare("INSERT INTO operations VALUES (?,?,?,?,?)").run(
      user,
      command.operationId,
      name,
      digest,
      JSON.stringify(receipt),
    );
    return receipt;
  })();
}
