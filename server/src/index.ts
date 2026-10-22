import { resolve } from "node:path";
import { buildApp } from "./app/index.ts";
import { openDatabase } from "./persistence/database.ts";
import { processOutbox, processReceipts } from "./messaging/outbox.ts";
const databasePath = process.env.DATABASE_PATH ?? resolve("data/alarmat.db");
const db = openDatabase(
  databasePath,
  process.env.MIGRATIONS_DIRECTORY ?? resolve("migrations"),
);
const app = await buildApp({
  db,
  logger: true,
  corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean),
  sessionDurationMs: Number(process.env.SESSION_DURATION_MS ?? 604800000),
  agent: {
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL,
  },
});
let running = false;
const interval =
  process.env.EXPO_PUSH_ENABLED === "true"
    ? setInterval(() => {
        if (running) return;
        running = true;
        void processOutbox(db, Date.now(), process.env.EXPO_ACCESS_TOKEN)
          .then(() =>
            processReceipts(db, Date.now(), process.env.EXPO_ACCESS_TOKEN),
          )
          .catch(() => app.log.error("push_worker_failed"))
          .finally(() => {
            running = false;
          });
      }, 15000)
    : null;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (interval) clearInterval(interval);
    void app.close().then(() => {
      db.close();
      process.exit(0);
    });
  });
await app.listen({
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3100),
});
