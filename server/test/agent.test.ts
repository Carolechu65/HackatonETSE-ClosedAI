import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { openDatabase } from "../src/persistence/database.ts";
import { draftAlarm } from "../src/agents/draft.ts";
function fixture() {
  const dir = mkdtempSync(resolve(tmpdir(), "alarmat-agent-")),
    db = openDatabase(resolve(dir, "agent.db"));
  for (const [id, name] of [
    ["a", "Emisor sintético"],
    ["b", "Ana"],
    ["c", "Tercero"],
  ])
    db.prepare(
      "INSERT INTO users(id,email,password_hash,display_name) VALUES (?,?,?,?)",
    ).run(id, `${id}@example.test`, "not-a-real-login", name);
  db.prepare("INSERT INTO groups VALUES (?,?,?,?)").run(
    "piso",
    "Piso sintético",
    "Europe/Madrid",
    "a",
  );
  for (const id of ["a", "b", "c"])
    db.prepare("INSERT INTO memberships VALUES (?,?,'member',1)").run(
      "piso",
      id,
    );
  return {
    db,
    close: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const response = (content: unknown) => async () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
    { status: 200 },
  );
test("agent validates provider output and isolates conversations; tests use explicit fake provider", async () => {
  const f = fixture(),
    now = Date.parse("2026-10-22T10:00:00Z");
  try {
    const clarification = await draftAlarm(
      f.db,
      "a",
      {
        groupId: "piso",
        text: "Recuérdale a Ana sacar la basura cuando vuelva",
      },
      now,
      {
        apiKey: "test-only",
        fetcher: response({
          status: "needs_clarification",
          question: "¿A qué hora?",
          missingFields: ["timeSpec"],
        }),
      },
    );
    assert.equal(clarification.status, "needs_clarification");
    await assert.rejects(
      () =>
        draftAlarm(
          f.db,
          "c",
          {
            groupId: "piso",
            text: "ver conversación",
            conversationId: clarification.conversationId,
          },
          now,
          { apiKey: "test-only" },
        ),
      /Conversación no disponible/,
    );
    const draft = {
      title: "Sacar basura",
      recipientUids: ["b"],
      mode: "ALARM",
      timeSpec: {
        timeZone: "Europe/Madrid",
        localDate: "2026-10-23",
        localTime: "18:30",
      },
    };
    const reply = await draftAlarm(
      f.db,
      "a",
      {
        groupId: "piso",
        text: "Mañana 18:30 como alarma",
        conversationId: clarification.conversationId,
      },
      now,
      { apiKey: "test-only", fetcher: response({ status: "draft", draft }) },
    );
    assert.equal(reply.status, "draft");
    assert.equal(
      (
        f.db.prepare("SELECT count(*) AS n FROM alarm_requests").get() as {
          n: number;
        }
      ).n,
      0,
    );
    await assert.rejects(
      () =>
        draftAlarm(f.db, "a", { groupId: "piso", text: "proponer" }, now, {
          apiKey: "test-only",
          fetcher: response({
            status: "draft",
            draft: { ...draft, recipientUids: ["outside"] },
          }),
        }),
      /no autorizados/,
    );
    await assert.rejects(
      () =>
        draftAlarm(f.db, "a", { groupId: "piso", text: "proponer" }, now, {}),
      /no está configurado/,
    );
    await assert.rejects(
      () =>
        draftAlarm(f.db, "a", { groupId: "piso", text: "proponer" }, now, {
          apiKey: "test-only",
          fetcher: response({ status: "accepted", actorUid: "b" }),
        }),
      /No se pudo consultar/,
    );
    f.db.prepare("UPDATE memberships SET active=0 WHERE user_id=?").run("a");
    await assert.rejects(
      () =>
        draftAlarm(
          f.db,
          "a",
          {
            groupId: "piso",
            text: "seguir",
            conversationId: clarification.conversationId,
          },
          now,
          { apiKey: "test-only" },
        ),
      /No perteneces/,
    );
  } finally {
    f.close();
  }
});
test(
  "OpenRouter live: synthetic clarification then reviewable draft, never creates an alarm",
  { skip: process.env.RUN_LIVE_AGENT !== "true" },
  async () => {
    const f = fixture();
    try {
      const config = {
          apiKey: process.env.OPENROUTER_API_KEY,
          model: process.env.OPENROUTER_MODEL,
        },
        now = Date.now();
      const first = await draftAlarm(
        f.db,
        "a",
        {
          groupId: "piso",
          text: "Recuérdale a Ana sacar la basura cuando vuelva",
        },
        now,
        config,
      );
      assert.equal(first.status, "needs_clarification");
      const second = await draftAlarm(
        f.db,
        "a",
        {
          groupId: "piso",
          text: "El 23 de octubre de 2027 a las 18:30, hora de Madrid, como notificación. Ana es la destinataria.",
          conversationId: first.conversationId,
        },
        now,
        config,
      );
      assert.equal(second.status, "draft");
      if (second.status === "draft") {
        assert.deepEqual(second.draft.recipientUids, ["b"]);
        assert.equal(second.requiresRecipientConsent, true);
      }
      assert.equal(
        (
          f.db.prepare("SELECT count(*) AS n FROM alarm_requests").get() as {
            n: number;
          }
        ).n,
        0,
      );
    } finally {
      f.close();
    }
  },
);
