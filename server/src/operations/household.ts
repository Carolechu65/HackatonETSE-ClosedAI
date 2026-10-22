import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "../persistence/database.ts";
import {
  canonical,
  DomainError,
  event,
  hash,
  id,
  identifier,
  member,
  object,
  secret,
  string,
} from "../app/support.ts";
import { isValidTimeZone } from "../../../src/domain/time.ts";
import {
  createTask,
  completeTask,
  cancelTask,
  type HouseholdTask,
  type TaskDraft,
  type TaskMember,
} from "../../../src/features/tasks/model.ts";
import { alarmRecord, withdraw } from "./alarms.ts";
type Row = Record<string, any>;
function taskOperation<T>(
  db: Db,
  user: string,
  kind: string,
  data: Record<string, unknown>,
  action: () => T,
): T {
  const operationId = identifier(data.operationId),
    digest = hash(canonical(data));
  const prior = db
    .prepare(
      "SELECT kind,payload_hash,receipt FROM operations WHERE actor_uid=? AND operation_id=?",
    )
    .get(user, operationId) as Row | undefined;
  if (prior) {
    if (prior.kind !== kind || prior.payload_hash !== digest)
      throw new DomainError("VERSION_CONFLICT", "operationId ya utilizado.");
    return JSON.parse(prior.receipt) as T;
  }
  const result = action();
  db.prepare("INSERT INTO operations VALUES (?,?,?,?,?)").run(
    user,
    operationId,
    kind,
    digest,
    JSON.stringify(result),
  );
  return result;
}
const taskDto = (r: Row): HouseholdTask => ({
  id: r.id,
  groupId: r.group_id,
  title: r.title,
  assigneeUid: r.assignee_uid,
  createdByUid: r.created_by_uid,
  activateAtEpochMs: r.activate_at,
  dueAtEpochMs: r.due_at,
  status: r.status,
  version: r.version,
  completedByUid: r.completed_by_uid,
  completedAtEpochMs: r.completed_at,
});
export function householdRoutes(
  app: FastifyInstance,
  db: Db,
  actor: (r: FastifyRequest) => string,
  now: () => number,
): void {
  const params = (r: FastifyRequest) =>
    r.params as { groupId: string; userId: string; taskId: string };
  const group = (groupId: string, userId: string) =>
    db
      .prepare(
        "SELECT g.id,g.name,g.time_zone AS timeZone,m.role FROM groups g JOIN memberships m ON m.group_id=g.id WHERE g.id=? AND m.user_id=? AND m.active=1",
      )
      .get(groupId, userId);
  const members = (groupId: string): TaskMember[] =>
    db
      .prepare(
        "SELECT user_id AS uid,CASE active WHEN 1 THEN 'active' ELSE 'removed' END AS status FROM memberships WHERE group_id=?",
      )
      .all(groupId) as TaskMember[];
  app.get("/v1/groups", async (r) => ({
    groups: db
      .prepare(
        "SELECT g.id,g.name,g.time_zone AS timeZone,m.role FROM groups g JOIN memberships m ON g.id=m.group_id WHERE m.user_id=? AND m.active=1 ORDER BY g.name",
      )
      .all(actor(r)),
  }));
  app.post("/v1/groups", async (r) => {
    const user = actor(r),
      data = object(r.body, ["name", "timeZone"]),
      name = string(data.name, 80),
      timeZone = data.timeZone ?? "Europe/Madrid";
    if (!isValidTimeZone(timeZone))
      throw new DomainError("INVALID_ARGUMENT", "Zona desconocida.");
    return db.transaction(() => {
      const groupId = id();
      db.prepare("INSERT INTO groups VALUES (?,?,?,?)").run(
        groupId,
        name,
        timeZone,
        user,
      );
      db.prepare("INSERT INTO memberships VALUES (?,?,'owner',1)").run(
        groupId,
        user,
      );
      return group(groupId, user);
    })();
  });
  app.get("/v1/groups/:groupId/members", async (r) => {
    const { groupId } = params(r);
    member(db, actor(r), groupId);
    return {
      members: db
        .prepare(
          "SELECT u.id AS userId,u.display_name AS displayName,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.group_id=? AND m.active=1 ORDER BY u.display_name",
        )
        .all(groupId),
    };
  });
  app.post("/v1/groups/:groupId/invitations", async (r) => {
    const { groupId } = params(r);
    if (member(db, actor(r), groupId).role !== "owner")
      throw new DomainError("FORBIDDEN", "Solo el administrador invita.");
    const data = object(r.body ?? {}, ["maxUses"]),
      maxUses = data.maxUses ?? 1;
    if (
      !Number.isSafeInteger(maxUses) ||
      Number(maxUses) < 1 ||
      Number(maxUses) > 6
    )
      throw new DomainError("INVALID_ARGUMENT", "Entre 1 y 6 usos.");
    const token = secret(),
      expiresAtEpochMs = now() + 86400000;
    db.prepare("INSERT INTO invitations VALUES (?,?,?,?)").run(
      hash(token),
      groupId,
      expiresAtEpochMs,
      Number(maxUses),
    );
    return { token, expiresAtEpochMs };
  });
  app.post("/v1/invitations/accept", async (r) => {
    const user = actor(r),
      token = string(object(r.body, ["token"]).token, 200);
    return db.transaction(() => {
      const inv = db
        .prepare(
          "SELECT * FROM invitations WHERE token_hash=? AND expires_at>? AND remaining_uses>0",
        )
        .get(hash(token), now()) as Row | undefined;
      if (!inv)
        throw new DomainError("EXPIRED", "Invitación caducada o consumida.");
      if (
        !db
          .prepare(
            "SELECT 1 FROM memberships WHERE group_id=? AND user_id=? AND active=1",
          )
          .get(inv.group_id, user)
      ) {
        db.prepare(
          "INSERT INTO memberships VALUES (?,?,'member',1) ON CONFLICT(group_id,user_id) DO UPDATE SET active=1,role='member'",
        ).run(inv.group_id, user);
        db.prepare(
          "UPDATE invitations SET remaining_uses=remaining_uses-1 WHERE token_hash=?",
        ).run(hash(token));
        for (const request of db
          .prepare(
            "SELECT a.id FROM alarm_requests a JOIN alarm_recipients r ON r.request_id=a.id WHERE a.group_id=? AND r.recipient_uid=?",
          )
          .all(inv.group_id, user) as Row[])
          event(db, user, inv.group_id, request.id, "upsert", now());
      }
      return group(inv.group_id, user);
    })();
  });
  app.delete("/v1/groups/:groupId/members/:userId", async (r) => {
    const user = actor(r),
      { groupId, userId } = params(r);
    return db.transaction(() => {
      const role = member(db, user, groupId).role;
      if (user !== userId && role !== "owner")
        throw new DomainError(
          "FORBIDDEN",
          "Solo el administrador puede quitar miembros.",
        );
      if (member(db, userId, groupId).role === "owner")
        throw new DomainError(
          "FORBIDDEN",
          "El administrador debe conservar el piso.",
        );
      db.prepare(
        "UPDATE memberships SET active=0 WHERE group_id=? AND user_id=?",
      ).run(groupId, userId);
      db.prepare(
        "UPDATE alarm_recipients SET decision='NEEDS_REVIEW',decision_revision=decision_revision+1,accepted_request_version=NULL,chosen_time_spec=NULL,consent_scope=NULL,updated_at=? WHERE recipient_uid=? AND decision='ACCEPTED' AND request_id IN (SELECT id FROM alarm_requests WHERE group_id=?)",
      ).run(now(), userId, groupId);
      db.prepare(
        "UPDATE device_schedules SET status='CANCEL_PENDING',updated_at=? WHERE recipient_uid=? AND request_id IN (SELECT id FROM alarm_requests WHERE group_id=?) AND status IN ('SCHEDULED','SCHEDULING','PENDING_PERMISSION')",
      ).run(now(), userId, groupId);
      event(db, userId, groupId, null, "revoke", now());
      return { ok: true };
    })();
  });
  for (const path of [
    "/v1/groups/:groupId/alarms",
    "/v1/groups/:groupId/alarm-requests",
  ])
    app.get(path, async (r) => {
      const user = actor(r),
        { groupId } = params(r);
      member(db, user, groupId);
      const rows = db
        .prepare(
          "SELECT a.id,r.recipient_uid FROM alarm_requests a JOIN alarm_recipients r ON r.request_id=a.id WHERE a.group_id=? AND (a.creator_uid=? OR r.recipient_uid=?) ORDER BY a.created_at DESC LIMIT 500",
        )
        .all(groupId, user, user) as Row[];
      return {
        alarms: rows.map((row) =>
          alarmRecord(db, user, groupId, row.id, row.recipient_uid),
        ),
      };
    });
  app.get("/v1/groups/:groupId/tasks", async (r) => {
    const { groupId } = params(r);
    member(db, actor(r), groupId);
    return {
      tasks: (
        db
          .prepare(
            "SELECT * FROM tasks WHERE group_id=? ORDER BY due_at,id LIMIT 500",
          )
          .all(groupId) as Row[]
      ).map(taskDto),
    };
  });
  app.post("/v1/groups/:groupId/tasks", async (r) => {
    const user = actor(r),
      { groupId } = params(r);
    const data = object(r.body, [
      "operationId",
      "title",
      "assigneeUid",
      "activateAtEpochMs",
      "dueAtEpochMs",
    ]);
    return db.transaction(() => {
      member(db, user, groupId);
      return taskOperation(db, user, "createTask", { ...data, groupId }, () => {
        const task = createTask({
          id: id(),
          groupId,
          createdByUid: user,
          draft: {
            title: data.title,
            assigneeUid: data.assigneeUid ?? null,
            activateAtEpochMs: data.activateAtEpochMs ?? null,
            dueAtEpochMs: data.dueAtEpochMs ?? null,
          } as TaskDraft,
          members: members(groupId),
        });
        db.prepare("INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
          task.id,
          groupId,
          task.title,
          task.assigneeUid,
          user,
          task.activateAtEpochMs,
          task.dueAtEpochMs,
          task.status,
          task.version,
          null,
          null,
        );
        return task;
      });
    })();
  });
  app.route({
    method: ["PATCH", "POST"],
    url: "/v1/groups/:groupId/tasks/:taskId",
    handler: async (r) => {
      const user = actor(r),
        { groupId, taskId } = params(r),
        data = object(r.body, ["operationId", "status", "expectedVersion"]);
      if (
        !["completed", "cancelled"].includes(String(data.status)) ||
        !Number.isSafeInteger(data.expectedVersion)
      )
        throw new DomainError(
          "INVALID_ARGUMENT",
          "Estado o versión inválidos.",
        );
      return db.transaction(() => {
        member(db, user, groupId);
        return taskOperation(
          db,
          user,
          "updateTask",
          { ...data, groupId, taskId },
          () => {
            const row = db
              .prepare("SELECT * FROM tasks WHERE id=? AND group_id=?")
              .get(taskId, groupId) as Row | undefined;
            if (!row)
              throw new DomainError("NOT_FOUND", "Tarea no disponible.");
            const current = taskDto(row);
            if (current.status === data.status) return current;
            if (current.version !== data.expectedVersion)
              throw new DomainError("VERSION_CONFLICT", "La tarea cambió.");
            const mutation = (
              data.status === "completed" ? completeTask : cancelTask
            )(current, {
              actorUid: user,
              members: members(groupId),
              nowEpochMs: now(),
            });
            const task = mutation.task;
            db.prepare(
              "UPDATE tasks SET status=?,version=?,completed_by_uid=?,completed_at=? WHERE id=?",
            ).run(
              task.status,
              task.version,
              task.completedByUid,
              task.completedAtEpochMs,
              taskId,
            );
            for (const alarm of db
              .prepare(
                "SELECT * FROM alarm_requests WHERE task_id=? AND status='ACTIVE'",
              )
              .all(taskId) as Row[])
              withdraw(db, alarm, now());
            return task;
          },
        );
      })();
    },
  });
  app.post("/v1/devices", async (r) => {
    const user = actor(r),
      data = object(r.body, ["deviceId", "platform", "pushToken"]),
      deviceId = identifier(data.deviceId);
    if (!["android", "ios", "web"].includes(String(data.platform)))
      throw new DomainError("INVALID_ARGUMENT", "Plataforma desconocida.");
    const pushToken =
      data.pushToken === undefined ? null : string(data.pushToken, 256);
    if (
      pushToken &&
      !/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(pushToken)
    )
      throw new DomainError("INVALID_ARGUMENT", "Token push inválido.");
    const exists = db
      .prepare("SELECT user_id FROM devices WHERE id=?")
      .get(deviceId) as Row | undefined;
    if (exists && exists.user_id !== user)
      throw new DomainError("FORBIDDEN", "Dispositivo ya registrado.");
    db.prepare(
      "INSERT INTO devices VALUES (?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET platform=excluded.platform,push_token=excluded.push_token,active=1",
    ).run(deviceId, user, data.platform, pushToken);
    return { deviceId, platform: data.platform };
  });
  app.route({
    method: ["PUT", "POST"],
    url: "/v1/devices/primary",
    handler: async (r) => {
      const user = actor(r),
        deviceId = identifier(object(r.body, ["deviceId"]).deviceId);
      return db.transaction(() => {
        if (
          !db
            .prepare(
              "SELECT 1 FROM devices WHERE id=? AND user_id=? AND active=1",
            )
            .get(deviceId, user)
        )
          throw new DomainError("FORBIDDEN", "Dispositivo no disponible.");
        const current = db
          .prepare(
            "SELECT primary_device_id,device_epoch FROM users WHERE id=?",
          )
          .get(user) as Row;
        if (current.primary_device_id !== deviceId) {
          db.prepare(
            "UPDATE users SET primary_device_id=?,device_epoch=device_epoch+1 WHERE id=?",
          ).run(deviceId, user);
          db.prepare(
            "UPDATE device_schedules SET status='CANCEL_PENDING',updated_at=? WHERE recipient_uid=? AND status IN ('SCHEDULED','SCHEDULING')",
          ).run(now(), user);
          for (const alarm of db
            .prepare(
              "SELECT a.id,a.group_id FROM alarm_requests a JOIN alarm_recipients r ON r.request_id=a.id JOIN memberships m ON m.group_id=a.group_id AND m.user_id=r.recipient_uid WHERE r.recipient_uid=? AND m.active=1",
            )
            .all(user) as Row[])
            event(db, user, alarm.group_id, alarm.id, "upsert", now());
        }
        return {
          deviceId,
          deviceEpoch:
            current.device_epoch +
            (current.primary_device_id !== deviceId ? 1 : 0),
        };
      })();
    },
  });
}
