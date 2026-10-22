import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { openDatabase, backupDatabase } from "../src/persistence/database.ts";
import { buildApp } from "../src/app/index.ts";
import { sync } from "../src/messaging/feed.ts";
import { processOutbox, processReceipts } from "../src/messaging/outbox.ts";
import { createTimeSpec } from "../../src/domain/time.ts";
import type { FastifyInstance, HTTPMethods } from "fastify";
const now = Date.parse("2026-10-22T10:00:00Z");
test("SQLite API: A proposes, only B decides; replay, stale ACK, revoke, backup and restart", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "alarmat-api-"));
  let db = openDatabase(resolve(dir, "live.db"));
  let app = await buildApp({ db, now: () => now });
  const call = async (
    method: HTTPMethods,
    url: string,
    payload?: unknown,
    token?: string,
  ) => {
    const r = await app.inject({
      method,
      url,
      payload: payload as object,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return { status: r.statusCode, body: r.json() };
  };
  const register = async (name: string) => {
    const response = await call("POST", "/v1/auth/register", {
      email: `${name}@example.test`,
      password: "safe-password-123",
      displayName: name,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body as { userId: string; token: string };
  };
  try {
    const a = await register("A"),
      b = await register("B"),
      c = await register("C"),
      outsider = await register("D");
    assert.equal(
      (
        await call("POST", "/v1/auth/login", {
          email: "A@example.test",
          password: "safe-password-123",
        })
      ).status,
      200,
    );
    const g = (
      await call(
        "POST",
        "/v1/groups",
        { name: "Piso pruebas", timeZone: "Europe/Madrid" },
        a.token,
      )
    ).body;
    const invite = await call(
      "POST",
      `/v1/groups/${g.id}/invitations`,
      { maxUses: 2 },
      a.token,
    );
    for (const person of [b, c])
      assert.equal(
        (
          await call(
            "POST",
            "/v1/invitations/accept",
            { token: invite.body.token },
            person.token,
          )
        ).status,
        200,
      );
    assert.equal(
      (
        await call(
          "POST",
          "/v1/invitations/accept",
          { token: invite.body.token },
          outsider.token,
        )
      ).status,
      410,
    );
    assert.equal(
      (
        await call(
          "GET",
          `/v1/groups/${g.id}/members`,
          undefined,
          outsider.token,
        )
      ).status,
      403,
    );
    const timeSpec = createTimeSpec({
      timeZone: "Europe/Madrid",
      localDate: "2026-10-23",
      localTime: "18:30",
    });
    const command = {
      schemaVersion: 1,
      operationId: "create-1",
      groupId: g.id,
      payload: {
        title: "Sacar basura",
        recipientUids: [b.userId],
        mode: "ALARM",
        timeSpec,
      },
    };
    const concurrent = await Promise.all([
      call("POST", "/v1/operations/createAlarmRequest", command, a.token),
      call("POST", "/v1/operations/createAlarmRequest", command, a.token),
    ]);
    assert.deepEqual(
      concurrent.map((r) => r.status),
      [200, 200],
      JSON.stringify(concurrent),
    );
    assert.deepEqual(concurrent.map((r) => r.body.status).sort(), [
      "APPLIED",
      "REPLAYED",
    ]);
    const requestId = concurrent[0]!.body.result.requestId;
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) AS count FROM alarm_requests").get() as {
          count: number;
        }
      ).count,
      1,
    );
    assert.equal(
      (
        await call(
          "POST",
          "/v1/operations/createAlarmRequest",
          { ...command, payload: { ...command.payload, title: "Changed" } },
          a.token,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await call(
          "POST",
          "/v1/operations/createAlarmRequest",
          { ...command, operationId: "actor-spoof", actorUid: b.userId },
          a.token,
        )
      ).status,
      400,
    );
    const inbox = await call("GET", "/v1/sync", undefined, b.token);
    assert.equal(inbox.body.events.length, 1);
    assert.equal(inbox.body.events[0].alarm.recipient.decision, "PENDING");
    assert.equal(
      (await call("GET", "/v1/sync", undefined, c.token)).body.events.length,
      0,
    );
    assert.equal(
      (
        await call(
          "GET",
          `/v1/sync?cursor=${inbox.body.nextCursor}`,
          undefined,
          c.token,
        )
      ).status,
      400,
    );
    const accept = {
      schemaVersion: 1,
      operationId: "accept-1",
      groupId: g.id,
      entityId: requestId,
      expectedRequestVersion: 1,
      expectedDecisionRevision: 1,
      payload: { decision: "ACCEPTED", consentScope: "THIS_OCCURRENCE" },
    };
    assert.equal(
      (await call("POST", "/v1/operations/respondToAlarm", accept, c.token))
        .status,
      404,
    );
    assert.equal(
      (await call("POST", "/v1/operations/respondToAlarm", accept, a.token))
        .status,
      404,
    );
    const accepted = await call(
      "POST",
      "/v1/operations/respondToAlarm",
      accept,
      b.token,
    );
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.decisionRevision, 2);
    assert.equal(
      (
        await call(
          "POST",
          "/v1/operations/respondToAlarm",
          { ...accept, operationId: "stale-accept" },
          b.token,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await call(
          "POST",
          "/v1/devices",
          {
            deviceId: "device-b",
            platform: "android",
            pushToken: "ExpoPushToken[test]",
          },
          b.token,
        )
      ).status,
      200,
    );
    const primary = await call(
      "POST",
      "/v1/devices/primary",
      { deviceId: "device-b" },
      b.token,
    );
    assert.equal(primary.status, 200, JSON.stringify(primary.body));
    assert.equal(primary.body.deviceEpoch, 1);
    const ack = {
      schemaVersion: 1,
      operationId: "ack-1",
      groupId: g.id,
      entityId: requestId,
      payload: {
        occurrenceId: `occ-${timeSpec.effectiveAtEpochMs}`,
        deviceId: "device-b",
        deviceEpoch: 1,
        requestVersion: 1,
        decisionRevision: 2,
        mode: "ALARM",
        mechanism: "ALARM_RUNTIME",
        status: "SCHEDULED",
        effectiveAtEpochMs: timeSpec.effectiveAtEpochMs,
        reportedAtEpochMs: now,
      },
    };
    assert.equal(
      (await call("POST", "/v1/operations/reportSchedule", ack, b.token))
        .status,
      200,
    );
    assert.equal(
      (
        await call(
          "POST",
          "/v1/operations/reportSchedule",
          {
            ...ack,
            operationId: "stale-ack",
            payload: { ...ack.payload, decisionRevision: 1 },
          },
          b.token,
        )
      ).status,
      409,
    );
    const withdrawn = await call(
      "POST",
      "/v1/operations/withdrawAlarmRequest",
      {
        schemaVersion: 1,
        operationId: "withdraw-1",
        groupId: g.id,
        entityId: requestId,
        expectedRequestVersion: 1,
        payload: { reason: "Ya está hecho" },
      },
      a.token,
    );
    assert.equal(withdrawn.status, 200);
    assert.equal(
      (
        await call(
          "POST",
          "/v1/operations/reportSchedule",
          {
            ...ack,
            operationId: "revive",
            payload: { ...ack.payload, requestVersion: 2 },
          },
          b.token,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "POST",
          "/v1/operations/reportSchedule",
          {
            ...ack,
            operationId: "cancel-ack",
            payload: { ...ack.payload, requestVersion: 2, status: "CANCELLED" },
          },
          b.token,
        )
      ).status,
      200,
    );
    const taskBody = {
      operationId: "task-create",
      title: "Lavar platos",
      assigneeUid: b.userId,
      activateAtEpochMs: null,
      dueAtEpochMs: null,
    };
    const task = await call(
      "POST",
      `/v1/groups/${g.id}/tasks`,
      taskBody,
      a.token,
    );
    assert.equal(task.status, 200, JSON.stringify(task.body));
    assert.deepEqual(
      (await call("POST", `/v1/groups/${g.id}/tasks`, taskBody, a.token)).body,
      task.body,
    );
    const taskAlarm = await call(
      "POST",
      "/v1/operations/createAlarmRequest",
      {
        ...command,
        operationId: "task-alarm",
        payload: { ...command.payload, taskId: task.body.id },
      },
      a.token,
    );
    assert.equal(taskAlarm.status, 200);
    const done = await call(
      "POST",
      `/v1/groups/${g.id}/tasks/${task.body.id}`,
      { operationId: "task-done", status: "completed", expectedVersion: 1 },
      b.token,
    );
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.version, 2);
    assert.equal(
      (
        db
          .prepare("SELECT status FROM alarm_requests WHERE id=?")
          .get(taskAlarm.body.result.requestId) as { status: string }
      ).status,
      "WITHDRAWN",
    );
    const outbound = await processOutbox(
      db,
      now,
      undefined,
      async () =>
        new Response(
          JSON.stringify({ data: [{ status: "ok", id: "ticket-test" }] }),
          { status: 200 },
        ),
    );
    assert.ok(outbound > 0);
    await processReceipts(
      db,
      now,
      undefined,
      async () =>
        new Response(
          JSON.stringify({
            data: {
              "ticket-test": {
                status: "error",
                details: { error: "DeviceNotRegistered" },
              },
            },
          }),
          { status: 200 },
        ),
    );
    assert.equal(
      (
        db
          .prepare("SELECT push_token FROM devices WHERE id=?")
          .get("device-b") as { push_token: string | null }
      ).push_token,
      null,
    );
    const before = sync(db, b.userId, undefined, now, 1);
    assert.equal(before.events.length, 1);
    assert.equal(before.hasMore, true);
    assert.throws(
      () => sync(db, b.userId, before.nextCursor, now + 8 * 86400000),
      /caducó/,
    );
    assert.equal(
      (
        await call(
          "DELETE",
          `/v1/groups/${g.id}/members/${b.userId}`,
          undefined,
          a.token,
        )
      ).status,
      200,
    );
    const revoked = await call(
      "GET",
      `/v1/sync?cursor=${inbox.body.nextCursor}`,
      undefined,
      b.token,
    );
    assert.ok(
      revoked.body.events.every((e: { kind: string }) => e.kind === "revoke"),
    );
    assert.equal(
      (await call("POST", "/v1/operations/respondToAlarm", accept, b.token))
        .status,
      403,
    );
    const reinvite = await call(
      "POST",
      `/v1/groups/${g.id}/invitations`,
      {},
      a.token,
    );
    assert.equal(
      (
        await call(
          "POST",
          "/v1/invitations/accept",
          { token: reinvite.body.token },
          b.token,
        )
      ).status,
      200,
    );
    const rejoined = await call(
      "GET",
      `/v1/sync?cursor=${revoked.body.nextCursor}`,
      undefined,
      b.token,
    );
    assert.ok(
      rejoined.body.events.some(
        (e: any) =>
          e.kind === "upsert" &&
          e.alarm.requestId === requestId &&
          e.alarm.recipient.decision === "NEEDS_REVIEW",
      ),
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT decision FROM alarm_recipients WHERE request_id=? AND recipient_uid=?",
          )
          .get(requestId, b.userId) as { decision: string }
      ).decision,
      "NEEDS_REVIEW",
    );
    assert.throws(
      () =>
        db
          .prepare("INSERT INTO memberships VALUES (?,?,?,1)")
          .run("missing-group", a.userId, "member"),
      /FOREIGN KEY/,
    );
    const count = (
      db.prepare("SELECT count(*) AS n FROM tasks").get() as { n: number }
    ).n;
    assert.throws(
      () =>
        db.transaction(() => {
          db.prepare("DELETE FROM tasks WHERE id=?").run("nonexistent");
          db.prepare("INSERT INTO memberships VALUES (?,?,?,1)").run(
            "bad",
            a.userId,
            "member",
          );
        })(),
      /FOREIGN KEY/,
    );
    assert.equal(
      (db.prepare("SELECT count(*) AS n FROM tasks").get() as { n: number }).n,
      count,
    );
    await backupDatabase(db, resolve(dir, "backup.db"));
    const copy = openDatabase(resolve(dir, "backup.db"));
    assert.equal(
      (copy.prepare("SELECT count(*) AS n FROM users").get() as { n: number })
        .n,
      4,
    );
    copy.close();
    await app.close();
    db.close();
    db = openDatabase(resolve(dir, "live.db"));
    app = await buildApp({ db, now: () => now });
    assert.equal(
      (await call("GET", "/v1/auth/me", undefined, a.token)).body.userId,
      a.userId,
    );
    assert.equal(
      (await call("POST", "/v1/auth/logout", {}, a.token)).status,
      200,
    );
    assert.equal(
      (await call("GET", "/v1/auth/me", undefined, a.token)).status,
      401,
    );
  } finally {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
