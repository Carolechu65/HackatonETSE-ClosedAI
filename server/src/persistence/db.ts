/**
 * Apertura de SQLite y migraciones numeradas.
 *
 * El proceso del VPS es el único escritor. Cada conexión verifica las PRAGMA
 * efectivas; una migración fallida no deja el esquema a medias.
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Db = Database.Database;

const MIGRATION_FILE = /^(\d{3,})_([a-z0-9_-]+)\.sql$/i;

export function openDatabase(databasePath: string): Db {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true, mode: 0o700 });
  }
  const db = new Database(databasePath);
  if(databasePath!==':memory:')chmodSync(databasePath,0o600);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = FULL');
  assertPragmas(db);
  return db;
}

export function assertPragmas(db: Db): void {
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  const busyTimeout = db.pragma('busy_timeout', { simple: true });
  const synchronous = db.pragma('synchronous', { simple: true });
  const journalMode = String(db.pragma('journal_mode', { simple: true })).toLowerCase();
  if (foreignKeys !== 1) throw new Error('SQLite: foreign_keys no está activo.');
  if (busyTimeout !== 5000) throw new Error('SQLite: busy_timeout inesperado.');
  if (synchronous !== 2) throw new Error('SQLite: synchronous no es FULL.');
  if (!['wal', 'memory'].includes(journalMode)) throw new Error(`SQLite: journal_mode=${journalMode}.`);
}

export function findMigrationsDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.ALARMAT_MIGRATIONS_DIR,
    resolve(moduleDir, '../../migrations'),
    resolve(moduleDir, '../../../../migrations'),
    resolve(process.cwd(), 'migrations'),
    resolve(process.cwd(), 'server/migrations'),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const hasMigration = readdirSync(candidate).some((name) => MIGRATION_FILE.test(name));
      if (hasMigration) return candidate;
    }
  }
  throw new Error(`No se encontró server/migrations (buscado en: ${candidates.join(', ')}).`);
}

export type MigrationResult = {
  applied: Array<{ version: number; name: string }>;
  alreadyApplied: number;
  schemaVersion: number;
};

export function migrate(db: Db, migrationsDir = findMigrationsDir()): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at_epoch_ms INTEGER NOT NULL
    );
  `);

  const files = readdirSync(migrationsDir)
    .map((name) => {
      const match = MIGRATION_FILE.exec(name);
      return match ? { name, version: Number(match[1]) } : null;
    })
    .filter((entry): entry is { name: string; version: number } => entry !== null)
    .sort((a, b) => a.version - b.version);

  if (files.length === 0) throw new Error('No hay migraciones disponibles.');

  const appliedRows = db.prepare('SELECT version, checksum, name FROM schema_migrations').all() as Array<{
    version: number;
    checksum: string;
    name: string;
  }>;
  const appliedByVersion = new Map(appliedRows.map((row) => [row.version, row]));
  const applied: MigrationResult['applied'] = [];

  for (const file of files) {
    const sql = readFileSync(resolve(migrationsDir, file.name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = appliedByVersion.get(file.version);
    if (previous) {
      if (previous.checksum !== checksum) {
        throw new Error(`La migración ${file.version} cambió después de aplicarse.`);
      }
      continue;
    }
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at_epoch_ms) VALUES (?, ?, ?, ?)',
      ).run(file.version, file.name, checksum, Date.now());
    });
    apply();
    applied.push({ version: file.version, name: file.name });
  }

  const versionRow = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number | null;
  };
  // Keep the observable SQLite metadata aligned without editing applied SQL checksums.
  db.pragma(`user_version = ${versionRow.version ?? 0}`);
  return { applied, alreadyApplied: appliedRows.length, schemaVersion: versionRow.version ?? 0 };
}

export function assertSchemaReady(db: Db): void {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!table) throw new Error('La base no tiene migraciones aplicadas. Ejecuta npm --prefix server run migrate.');
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
  if (!row.version || row.version < 4) throw new Error('La base requiere migración 004. Ejecuta npm --prefix server run migrate.');
}

export function integrityCheck(db: Db): string {
  const result = db.pragma('integrity_check', { simple: true });
  return String(result);
}
