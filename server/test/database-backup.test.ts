import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { statSync } from 'node:fs';
import { setupTest, registerUser } from './helpers.ts';
import { openDatabase, integrityCheck } from '../src/persistence/db.ts';
test('online backup restores canonical migrations and data; foreign-key failure rolls back atomically', async () => {
  const ctx = await setupTest({ fileDatabase: true });
  try {
    const user = await registerUser(ctx.app, 'Backup sintético');
    assert.throws(
      () =>
        ctx.db.transaction(() => {
          ctx.db.prepare("UPDATE users SET display_name='Must rollback' WHERE id=?").run(user.uid);
          ctx.db
            .prepare(
              "INSERT INTO memberships(group_id,user_id,role,status,joined_at_epoch_ms) VALUES ('missing',?,'MEMBER','ACTIVE',?)",
            )
            .run(user.uid, Date.now());
        })(),
      /FOREIGN KEY/,
    );
    assert.equal(
      (
        ctx.db.prepare('SELECT display_name FROM users WHERE id=?').get(user.uid) as {
          display_name: string;
        }
      ).display_name,
      'Backup sintético',
    );
    const backup = join(ctx.dir, 'restored.db');
    await ctx.db.backup(backup);
    const restored = openDatabase(backup);
    try {
      assert.equal(integrityCheck(restored), 'ok');
      assert.equal(
        (
          restored.prepare('SELECT display_name FROM users WHERE id=?').get(user.uid) as {
            display_name: string;
          }
        ).display_name,
        'Backup sintético',
      );
      assert.equal(restored.pragma('user_version', { simple: true }), 2);
      assert.equal(statSync(backup).mode & 0o777, 0o600);
    } finally {
      restored.close();
    }
  } finally {
    await ctx.close();
  }
});
