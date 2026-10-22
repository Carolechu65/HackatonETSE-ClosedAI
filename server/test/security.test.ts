import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { openDatabase } from "../src/persistence/database.ts";
import { buildApp } from "../src/app/index.ts";
import { processOutbox } from "../src/messaging/outbox.ts";
import { hash } from "../src/app/support.ts";
test("private storage, expired auth/invites, forged fields, and outbox backoff", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "alarmat-security-")),
    db = openDatabase(resolve(dir, "test.db"));
  let now = Date.now();
  const app = await buildApp({ db, now: () => now, sessionDurationMs: 10000 });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        email: "member@example.test",
        displayName: "Ana",
        password: "password-test-123",
      },
    });
    assert.equal(response.statusCode, 200);
    const session = response.json();
    const headers = { authorization: `Bearer ${session.token}` };
    const stored = db.prepare("SELECT * FROM sessions").get() as {
      token_hash: string;
    };
    assert.equal(stored.token_hash, hash(session.token));
    assert.notEqual(stored.token_hash, session.token);
    const user = db.prepare("SELECT password_hash FROM users").get() as {
      password_hash: string;
    };
    assert.match(user.password_hash, /^\$argon2id\$/);
    assert.equal(
      (await app.inject({ url: `/v1/auth/me?token=${session.token}` }))
        .statusCode,
      401,
    );
    const malformed = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "x", password: "tiny", actorUid: "a" },
    });
    assert.equal(malformed.statusCode, 400);
    const group = (
      await app.inject({
        method: "POST",
        url: "/v1/groups",
        headers,
        payload: { name: "Piso" },
      })
    ).json();
    const invite = (
      await app.inject({
        method: "POST",
        url: `/v1/groups/${group.id}/invitations`,
        headers,
        payload: {},
      })
    ).json();
    db.prepare("UPDATE invitations SET expires_at=?").run(now - 1);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/invitations/accept",
          headers,
          payload: { token: invite.token },
        })
      ).statusCode,
      410,
    );
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/operations/createAlarmRequest",
      headers,
      payload: {
        schemaVersion: 1,
        operationId: "x",
        groupId: group.id,
        payload: {
          title: "Bad",
          recipientUids: [session.userId],
          mode: "BOOM",
          timeSpec: {},
        },
      },
    });
    assert.equal(invalid.statusCode, 400);
    now += 10001;
    assert.equal(
      (await app.inject({ url: "/v1/auth/me", headers })).statusCode,
      401,
    );
    db.prepare(
      "INSERT INTO alarm_requests(id,group_id,creator_uid,title,request_version,status,mode,time_spec,created_at,updated_at) VALUES ('req',?,?,?,1,'ACTIVE','ALARM','{}',?,?)",
    ).run(group.id, session.userId, "Synthetic", now, now);
    db.prepare(
      "INSERT INTO devices VALUES ('device',?,'android','ExpoPushToken[test]',1)",
    ).run(session.userId);
    db.prepare(
      "INSERT INTO outbox_events(id,user_id,request_id,request_version,available_at) VALUES ('event',?,'req',1,?)",
    ).run(session.userId, now);
    await processOutbox(db, now, undefined, async () => {
      throw new Error("simulated offline");
    });
    const outbox = db
      .prepare(
        "SELECT attempts,lease_until,available_at,delivered_at FROM outbox_events",
      )
      .get() as {
      attempts: number;
      lease_until: null;
      available_at: number;
      delivered_at: null;
    };
    assert.equal(outbox.attempts, 1);
    assert.equal(outbox.delivered_at, null);
    assert.ok(outbox.available_at > now);
    assert.equal(outbox.lease_until, null);
    db.prepare("UPDATE outbox_events SET lease_until=?,available_at=?").run(
      now + 500,
      now,
    );
    assert.equal(
      await processOutbox(db, now, undefined, async () => {
        throw new Error("must not call");
      }),
      0,
    );
  } finally {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
