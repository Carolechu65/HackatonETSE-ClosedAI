import { SerialQueue } from '../model.ts';

export type SqlValue = string | number | null;
/** Small structural subset of expo-sqlite; tests use the SAME SQL with node:sqlite. */
export interface SqlDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: SqlValue[]): Promise<{ changes: number }>;
  getFirstAsync<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
  closeAsync(): Promise<void>;
}

const migration1 = `
CREATE TABLE projections (
 user_id TEXT NOT NULL, group_id TEXT NOT NULL, request_id TEXT NOT NULL,
 recipient_uid TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(user_id, group_id, request_id, recipient_uid));
CREATE TABLE outbox (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
 operation_id TEXT NOT NULL, group_id TEXT NOT NULL, request_id TEXT,
 kind TEXT NOT NULL, lane TEXT NOT NULL CHECK(lane IN ('COMMAND','ACK')),
 command TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN
 ('QUEUED','SENDING','CONFIRMED','CONFLICT','FAILED_PERMANENT')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL, error_code TEXT, receipt TEXT,
 UNIQUE(user_id, operation_id));
CREATE INDEX outbox_due ON outbox(user_id, state, next_attempt_at, sequence);
CREATE TABLE local_schedules (
 user_id TEXT NOT NULL, occurrence_key TEXT NOT NULL, group_id TEXT NOT NULL,
 request_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(user_id, occurrence_key));
CREATE TABLE cancellation_barriers (
 user_id TEXT NOT NULL, group_id TEXT NOT NULL, request_id TEXT NOT NULL,
 body TEXT NOT NULL, PRIMARY KEY(user_id, group_id, request_id));
CREATE TABLE sync_state (
 user_id TEXT PRIMARY KEY, cursor TEXT, synced_at INTEGER,
 runtime_revision INTEGER NOT NULL DEFAULT -1);
CREATE TABLE received_events (
 user_id TEXT NOT NULL, event_id TEXT NOT NULL, PRIMARY KEY(user_id, event_id));
CREATE TABLE revoked_scopes (
 user_id TEXT NOT NULL, group_id TEXT NOT NULL, request_id TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(user_id, group_id, request_id));
CREATE TABLE widget_snapshots (user_id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE cleanup_pending (user_id TEXT PRIMARY KEY);
PRAGMA user_version = 1;
`;

const migration2 = `
CREATE TABLE account_owner (singleton INTEGER PRIMARY KEY CHECK(singleton=1), user_id TEXT NOT NULL);
INSERT INTO account_owner(singleton,user_id)
 SELECT 1,MIN(user_id) FROM (
  SELECT user_id FROM projections UNION SELECT user_id FROM outbox
  UNION SELECT user_id FROM local_schedules UNION SELECT user_id FROM cleanup_pending
  UNION SELECT user_id FROM cancellation_barriers UNION SELECT user_id FROM sync_state
  UNION SELECT user_id FROM received_events UNION SELECT user_id FROM revoked_scopes UNION SELECT user_id FROM widget_snapshots
 ) HAVING COUNT(DISTINCT user_id)=1;
PRAGMA user_version = 2;
`;

/** Owns a dedicated connection. No caller may run SQL on it outside this queue. */
export class LocalDatabase {
  private readonly queue = new SerialQueue();
  private readonly db: SqlDatabase;
  constructor(db: SqlDatabase) { this.db = db; }

  async initialize(): Promise<void> {
    await this.queue.run(async () => {
      await this.db.execAsync('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;');
      await this.db.execAsync('BEGIN IMMEDIATE');
      try {
        const version = (await this.db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))!.user_version;
        if (version > 2) throw new Error('La base local requiere una versión más reciente de la app.');
        if (version === 0) await this.db.execAsync(migration1);
        if (version < 2) {
          const owners = await this.db.getAllAsync<{ user_id: string }>(`SELECT user_id FROM projections UNION SELECT user_id FROM outbox
            UNION SELECT user_id FROM local_schedules UNION SELECT user_id FROM cleanup_pending
            UNION SELECT user_id FROM cancellation_barriers UNION SELECT user_id FROM sync_state
            UNION SELECT user_id FROM received_events UNION SELECT user_id FROM revoked_scopes UNION SELECT user_id FROM widget_snapshots`);
          if (owners.length > 1) throw new Error('La migración necesita resolver las cuentas locales anteriores antes de continuar.');
          await this.db.execAsync(migration2);
        }
        // initialize is called once on process startup, before a sender can run.
        await this.db.runAsync("UPDATE outbox SET state='QUEUED' WHERE state='SENDING'");
        await this.db.execAsync('COMMIT');
      } catch (error) {
        await this.db.execAsync('ROLLBACK');
        throw error;
      }
    });
  }

  read<T>(action: (db: SqlDatabase) => Promise<T>): Promise<T> {
    return this.queue.run(() => action(this.db));
  }

  transaction<T>(action: (db: SqlDatabase) => Promise<T>): Promise<T> {
    return this.queue.run(async () => {
      await this.db.execAsync('BEGIN IMMEDIATE');
      try {
        const result = await action(this.db);
        await this.db.execAsync('COMMIT');
        return result;
      } catch (error) {
        await this.db.execAsync('ROLLBACK');
        throw error;
      }
    });
  }

  close(): Promise<void> { return this.queue.run(() => this.db.closeAsync()); }
}
