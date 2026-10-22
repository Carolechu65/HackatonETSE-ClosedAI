import type { Db } from "../persistence/database.ts";
import { DomainError, secret } from "../app/support.ts";
import { alarmRecord, type AlarmRecord } from "../operations/alarms.ts";
type Change = {
  seq: number;
  group_id: string;
  request_id: string | null;
  kind: "upsert" | "revoke";
};
export type SyncEvent =
  | { eventId: string; kind: "upsert"; alarm: AlarmRecord }
  | { eventId: string; kind: "revoke"; groupId: string; requestId?: string };
export function sync(
  db: Db,
  user: string,
  cursor: unknown,
  now: number,
  limit = 100,
): {
  events: SyncEvent[];
  nextCursor: string;
  hasMore: boolean;
  serverTimeEpochMs: number;
} {
  return db.transaction(() => {
    let seq = 0;
    if (cursor !== undefined) {
      if (typeof cursor !== "string" || cursor.length > 100)
        throw new DomainError("INVALID_ARGUMENT", "Cursor inválido.");
      const row = db
        .prepare(
          "SELECT seq,expires_at FROM sync_cursors WHERE token=? AND user_id=?",
        )
        .get(cursor, user) as { seq: number; expires_at: number } | undefined;
      if (!row)
        throw new DomainError(
          "INVALID_ARGUMENT",
          "Cursor no válido para la sesión.",
        );
      if (row.expires_at <= now)
        throw new DomainError(
          "EXPIRED",
          "El cursor caducó. Solicita una nueva instantánea.",
        );
      seq = row.seq;
    }
    const rows = db
      .prepare(
        "SELECT seq,group_id,request_id,kind FROM change_events WHERE user_id=? AND seq>? ORDER BY seq LIMIT ?",
      )
      .all(user, seq, limit + 1) as Change[];
    const events: SyncEvent[] = [];
    for (const row of rows.slice(0, limit)) {
      seq = row.seq;
      const active = db
        .prepare(
          "SELECT 1 FROM memberships WHERE user_id=? AND group_id=? AND active=1",
        )
        .get(user, row.group_id);
      if (!active || row.kind === "revoke") {
        events.push({
          eventId: String(row.seq),
          kind: "revoke",
          groupId: row.group_id,
          ...(row.request_id ? { requestId: row.request_id } : {}),
        });
        continue;
      }
      if (row.request_id) {
        try {
          events.push({
            eventId: String(row.seq),
            kind: "upsert",
            alarm: alarmRecord(db, user, row.group_id, row.request_id),
          });
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          events.push({
            eventId: String(row.seq),
            kind: "revoke",
            groupId: row.group_id,
            requestId: row.request_id,
          });
        }
      }
    }
    const nextCursor = secret();
    db.prepare("INSERT INTO sync_cursors VALUES (?,?,?,?)").run(
      nextCursor,
      user,
      seq,
      now + 7 * 86400000,
    );
    db.prepare("DELETE FROM sync_cursors WHERE expires_at<?").run(
      now - 86400000,
    );
    return {
      events,
      nextCursor,
      hasMore: rows.length > limit,
      serverTimeEpochMs: now,
    };
  })();
}
