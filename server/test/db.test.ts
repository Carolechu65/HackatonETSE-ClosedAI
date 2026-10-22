import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSchemaReady, findMigrationsDir, integrityCheck, migrate, openDatabase } from '../src/persistence/db.ts';
import { auth, registerUser, setupTest } from './helpers.ts';

test('migraciones idempotentes, PRAGMA efectivas y persistencia tras reinicio', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alarmat-db-'));
  const path = join(dir, 'alarmat.db');
  try {
    const db = openDatabase(path);
    const first = migrate(db);
    assert.equal(first.schemaVersion, 4);
    assert.equal(db.pragma('user_version', { simple: true }), 4);
    assert.equal(first.applied.length, 4);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
    assert.equal(db.pragma('synchronous', { simple: true }), 2);
    assert.equal(String(db.pragma('journal_mode', { simple: true })).toLowerCase(), 'wal');
    assert.equal(integrityCheck(db), 'ok');

    const second = migrate(db);
    assert.equal(second.applied.length, 0);
    assert.equal(second.alreadyApplied, 4);

    db.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, device_epoch, created_at_epoch_ms, updated_at_epoch_ms)
       VALUES ('usr-persist', 'persist@example.test', 'hash', 'Persist', 0, 1, 1)`,
    ).run();
    db.close();

    const reopened = openDatabase(path);
    const row = reopened.prepare('SELECT display_name FROM users WHERE id = ?').get('usr-persist') as {
      display_name: string;
    };
    assert.equal(row.display_name, 'Persist');
    assert.equal(reintegrity(reopened), 'ok');
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function reintegrity(db: ReturnType<typeof openDatabase>): string {
  return integrityCheck(db);
}

test('migration 003 preserves existing tasks and requires migration before serving', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alarmat-upgrade-'));
  const legacy = join(dir, 'migrations');
  mkdirSync(legacy);
  for (const file of ['001_init.sql', '002_product_integration.sql'])
    copyFileSync(join(findMigrationsDir(), file), join(legacy, file));
  const db = openDatabase(join(dir, 'legacy.db'));
  try {
    migrate(db, legacy);
    db.exec(`
      INSERT INTO users(id,email,password_hash,display_name,device_epoch,created_at_epoch_ms,updated_at_epoch_ms)
        VALUES('usr-legacy','legacy@example.test','unused','Legacy',0,1,1);
      INSERT INTO groups(id,name,time_zone,created_by,created_at_epoch_ms,updated_at_epoch_ms)
        VALUES('grp-legacy','Piso','Europe/Madrid','usr-legacy',1,1);
      INSERT INTO tasks(id,group_id,title,status,version,created_at_epoch_ms,updated_at_epoch_ms,created_by_uid)
        VALUES('task-legacy','grp-legacy','Tarea anterior','PENDING',1,1,1,'usr-legacy');
    `);
    assert.throws(() => assertSchemaReady(db), /004/);
    assert.equal(migrate(db).applied.length, 2);
    assertSchemaReady(db);
    assert.deepEqual(db.prepare('SELECT title,description,category FROM tasks WHERE id=?').get('task-legacy'),
      { title: 'Tarea anterior', description: null, category: null });
    assert.equal(integrityCheck(db), 'ok');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('el dispositivo principal y su epoch controlan los acuses', async () => {
  const ctx = await setupTest();
  try {
    const user = await registerUser(ctx.app);
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/v1/devices',
      headers: auth(user.token),
      payload: { platform: 'android' },
    });
    assert.equal(first.statusCode, 201);
    assert.equal(first.json().primary, true);
    assert.equal(first.json().deviceEpoch, 1);

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/v1/devices',
      headers: auth(user.token),
      payload: { platform: 'android' },
    });
    assert.equal(second.statusCode, 201);
    assert.equal(second.json().primary, false);
    assert.equal(second.json().deviceEpoch, 1);

    const promote = await ctx.app.inject({
      method: 'POST',
      url: `/v1/devices/${second.json().deviceId}/primary`,
      headers: auth(user.token),
    });
    assert.equal(promote.statusCode, 200);
    assert.equal(promote.json().deviceEpoch, 2);

    const me = await ctx.app.inject({ method: 'GET', url: '/v1/auth/me', headers: auth(user.token) });
    assert.equal(me.json().user.primaryDeviceId, second.json().deviceId);
    assert.equal(me.json().user.deviceEpoch, 2);

    const other = await registerUser(ctx.app);
    const steal = await ctx.app.inject({
      method: 'POST',
      url: '/v1/devices',
      headers: auth(other.token),
      payload: { platform: 'android', deviceId: first.json().deviceId },
    });
    assert.equal(steal.statusCode, 403);
  } finally {
    await ctx.close();
  }
});
