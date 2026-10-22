import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type Db = Database.Database;
export function openDatabase(
  filename: string,
  migrationsDirectory = resolve(process.cwd(), "migrations"),
): Db {
  if (filename !== ":memory:")
    mkdirSync(dirname(resolve(filename)), { recursive: true, mode: 0o700 });
  const db = new Database(filename);
  if (filename !== ":memory:") chmodSync(filename, 0o600);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = FULL");
  if (
    db.pragma("foreign_keys", { simple: true }) !== 1 ||
    db.pragma("synchronous", { simple: true }) !== 2
  )
    throw new Error("SQLite durability configuration failed");
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  db.transaction(() => {
    for (const file of readdirSync(migrationsDirectory)
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort()) {
      if (
        db.prepare("SELECT 1 FROM schema_migrations WHERE version=?").get(file)
      )
        continue;
      db.exec(readFileSync(resolve(migrationsDirectory, file), "utf8"));
      db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(
        file,
        Date.now(),
      );
    }
  }).exclusive();
  return db;
}
export async function backupDatabase(
  db: Db,
  destination: string,
): Promise<void> {
  mkdirSync(dirname(resolve(destination)), { recursive: true, mode: 0o700 });
  await db.backup(destination);
  chmodSync(destination, 0o600);
  const copy = new Database(destination, { readonly: true });
  try {
    if (copy.pragma("integrity_check", { simple: true }) !== "ok")
      throw new Error("Backup integrity check failed");
  } finally {
    copy.close();
  }
}
