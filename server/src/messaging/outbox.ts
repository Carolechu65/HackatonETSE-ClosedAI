import type { Db } from "../persistence/database.ts";
// Optional transport. The persisted outbox and foreground feed work without Expo credentials.
export async function processOutbox(
  db: Db,
  now: number,
  accessToken?: string,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  type Row = {
    id: string;
    user_id: string;
    request_id: string;
    request_version: number;
    attempts: number;
  };
  const rows = db.transaction(() => {
    const pending = db
      .prepare(
        "SELECT * FROM outbox_events WHERE delivered_at IS NULL AND available_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY available_at LIMIT 20",
      )
      .all(now, now) as Row[];
    for (const row of pending)
      db.prepare(
        "UPDATE outbox_events SET lease_until=?,attempts=attempts+1 WHERE id=?",
      ).run(now + 60000, row.id);
    return pending;
  })();
  let delivered = 0;
  for (const row of rows) {
    try {
      const devices = db
        .prepare(
          "SELECT d.id,d.push_token FROM devices d JOIN memberships m ON m.user_id=d.user_id JOIN alarm_requests a ON a.group_id=m.group_id WHERE d.user_id=? AND a.id=? AND m.active=1 AND d.active=1 AND d.push_token IS NOT NULL",
        )
        .all(row.user_id, row.request_id) as {
        id: string;
        push_token: string;
      }[];
      if (devices.length) {
        const response = await fetcher("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(
            devices.map((d) => ({
              to: d.push_token,
              data: {
                eventId: row.id,
                requestId: row.request_id,
                requestVersion: row.request_version,
              },
            })),
          ),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error("push_transport");
        const json = (await response.json()) as {
          data?: {
            status: string;
            id?: string;
            details?: { error?: string };
          }[];
        };
        if (!Array.isArray(json.data) || json.data.length !== devices.length)
          throw new Error("push_response");
        for (const [index, ticket] of json.data.entries()) {
          if (ticket.status === "ok" && ticket.id)
            db.prepare(
              "INSERT OR IGNORE INTO push_receipts(ticket_id,event_id,device_id) VALUES (?,?,?)",
            ).run(ticket.id, row.id, devices[index]!.id);
          else if (ticket.details?.error === "DeviceNotRegistered")
            db.prepare("UPDATE devices SET push_token=NULL WHERE id=?").run(
              devices[index]!.id,
            );
          else throw new Error("push_ticket");
        }
      }
      db.prepare(
        "UPDATE outbox_events SET delivered_at=?,lease_until=NULL WHERE id=?",
      ).run(now, row.id);
      delivered++;
    } catch {
      db.prepare(
        "UPDATE outbox_events SET lease_until=NULL,available_at=?,last_error='delivery_failed' WHERE id=?",
      ).run(
        now + Math.min(3600000, 1000 * 2 ** Math.min(row.attempts, 12)),
        row.id,
      );
    }
  }
  return delivered;
}
export async function processReceipts(
  db: Db,
  now: number,
  accessToken?: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const rows = db
    .prepare(
      "SELECT ticket_id,device_id FROM push_receipts WHERE checked_at IS NULL LIMIT 100",
    )
    .all() as { ticket_id: string; device_id: string }[];
  if (!rows.length) return;
  const response = await fetcher(
    "https://exp.host/--/api/v2/push/getReceipts",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ ids: rows.map((r) => r.ticket_id) }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error("push_receipt_transport");
  const json = (await response.json()) as {
    data?: Record<string, { status: string; details?: { error?: string } }>;
  };
  db.transaction(() => {
    for (const row of rows) {
      const receipt = json.data?.[row.ticket_id];
      if (!receipt) continue;
      if (receipt.details?.error === "DeviceNotRegistered")
        db.prepare("UPDATE devices SET push_token=NULL WHERE id=?").run(
          row.device_id,
        );
      db.prepare("UPDATE push_receipts SET checked_at=? WHERE ticket_id=?").run(
        now,
        row.ticket_id,
      );
    }
  })();
}
