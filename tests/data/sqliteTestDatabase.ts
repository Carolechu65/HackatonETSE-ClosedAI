import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDatabase, type SqlDatabase } from '../../src/data/local/database.ts';
import { LocalStore } from '../../src/data/local/store.ts';

/** Runs production migrations and SQL on a real, file-backed SQLite connection. */
export function sqliteAdapter(path: string): SqlDatabase {
  const sqlite = new DatabaseSync(path);
  return {
    async execAsync(sql) { sqlite.exec(sql); },
    async runAsync(sql, ...params) {
      return { changes: Number(sqlite.prepare(sql).run(...params).changes) };
    },
    async getFirstAsync<T>(sql: string, ...params: (string | number | null)[]) {
      return (sqlite.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async getAllAsync<T>(sql: string, ...params: (string | number | null)[]) {
      return sqlite.prepare(sql).all(...params) as T[];
    },
    async closeAsync() { sqlite.close(); },
  };
}

export async function openTestStore(path?: string) {
  const directory = path ? undefined : await mkdtemp(join(tmpdir(), 'alarmat-sqlite-'));
  const filename = path ?? join(directory!, 'local.sqlite');
  const database = new LocalDatabase(sqliteAdapter(filename));
  await database.initialize();
  let closed = false;
  const close = async () => {
    if (!closed) { closed = true; await database.close(); }
  };
  return {
    store: new LocalStore(database), database, path: filename, close,
    async cleanup() {
      await close();
      if (directory) await rm(directory, { recursive: true, force: true });
    },
  };
}
