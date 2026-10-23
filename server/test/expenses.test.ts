import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { findMigrationsDir, integrityCheck, migrate, openDatabase } from '../src/persistence/db.ts';
import { auth, createGroup, inviteAndJoin, operationId, registerUser, setupTest } from './helpers.ts';

async function household() {
  const ctx = await setupTest();
  const owner = await registerUser(ctx.app, 'Pagador');
  const member = await registerUser(ctx.app, 'Participante');
  const third = await registerUser(ctx.app, 'Tercero');
  const outsider = await registerUser(ctx.app, 'Otro piso');
  const groupId = await createGroup(ctx.app, owner);
  await inviteAndJoin(ctx.app, owner, groupId, member);
  await inviteAndJoin(ctx.app, owner, groupId, third);
  return { ...ctx, owner, member, third, outsider, groupId,
    url: `/v1/groups/${groupId}/expenses`,
    input: { operationId: operationId('expense'), title: 'Compra semanal', amountCents: 100,
      participantUids: [owner.uid, member.uid, third.uid] } };
}

test('expenses: EUR integer shares sum exactly, payer settled and create retry does not duplicate', async () => {
  const ctx = await household();
  try {
    const create = () => ctx.app.inject({ method: 'POST', url: ctx.url, headers: auth(ctx.owner.token), payload: ctx.input });
    const response = await create();
    assert.equal(response.statusCode, 200, response.body);
    const { expense } = response.json();
    assert.deepEqual(expense.participantUids, [...ctx.input.participantUids].sort());
    assert.deepEqual(expense.shares.map((share: { amountCents: number }) => share.amountCents), [34, 33, 33]);
    assert.equal(expense.shares.reduce((total: number, share: { amountCents: number }) => total + share.amountCents, 0), 100);
    assert.deepEqual(expense.settledUids, [ctx.owner.uid]);
    assert.equal(expense.paidByUid, ctx.owner.uid);
    assert.equal(expense.version, 1);
    assert.deepEqual((await create()).json(), response.json());
    const list = await ctx.app.inject({ method: 'GET', url: ctx.url, headers: auth(ctx.member.token) });
    assert.deepEqual(list.json(), { currency: 'EUR', expenses: [expense] });
    const conflict = await ctx.app.inject({ method: 'POST', url: ctx.url, headers: auth(ctx.owner.token), payload: { ...ctx.input, amountCents: 101 } });
    assert.equal(conflict.statusCode, 409);
    assert.equal((ctx.db.prepare('SELECT COUNT(*) AS count FROM shared_expenses').get() as { count: number }).count, 1);
  } finally { await ctx.close(); }
});

test('expenses: authenticate and authorize every route without leaking another household', async () => {
  const ctx = await household();
  try {
    const created = await ctx.app.inject({ method: 'POST', url: ctx.url, headers: auth(ctx.owner.token), payload: ctx.input });
    const expense = created.json().expense;
    for (const token of [undefined, ctx.outsider.token]) {
      for (const options of [
        { method: 'GET' as const, url: ctx.url },
        { method: 'POST' as const, url: ctx.url, payload: ctx.input },
        { method: 'POST' as const, url: `${ctx.url}/${expense.id}/settle`, payload: { operationId: operationId(), expectedVersion: 1 } },
      ]) {
        const response = await ctx.app.inject({ ...options, headers: token ? auth(token) : {} });
        assert.equal(response.statusCode, token ? 404 : 401, response.body);
        assert.ok(!response.body.includes('Compra semanal'));
      }
    }
    const otherGroup = await createGroup(ctx.app, ctx.owner, 'Otro grupo propio');
    const wrongScope = await ctx.app.inject({ method: 'POST', url: `/v1/groups/${otherGroup}/expenses/${expense.id}/settle`,
      headers: auth(ctx.owner.token), payload: { operationId: operationId(), expectedVersion: 1 } });
    assert.equal(wrongScope.statusCode, 404);
    await ctx.app.inject({ method: 'POST', url: `/v1/groups/${ctx.groupId}/leave`, headers: auth(ctx.member.token) });
    assert.equal((await ctx.app.inject({ method: 'GET', url: ctx.url, headers: auth(ctx.member.token) })).statusCode, 404);
  } finally { await ctx.close(); }
});

test('expenses: reject invalid amounts, titles, duplicate or inactive participants and payer impersonation', async () => {
  const ctx = await household();
  try {
    const invalid = [
      ...[0, -1, 1.1, 100000001, Number.MAX_SAFE_INTEGER + 1, '100', null].map(amountCents => ({ amountCents })),
      { title: ' ' }, { title: 'x'.repeat(121) }, { participantUids: [] },
      { participantUids: [ctx.owner.uid, ctx.owner.uid] },
      { participantUids: [ctx.owner.uid, ctx.outsider.uid] },
      ...['2026-02-30', '2025-02-29', '2026-13-01', '2026-1-01', '', null, 20261231].map(dueDate => ({ dueDate })),
      { paidByUid: ctx.member.uid }, { currency: 'USD' },
    ];
    for (const extra of invalid) {
      const response = await ctx.app.inject({ method: 'POST', url: ctx.url, headers: auth(ctx.owner.token),
        payload: { ...ctx.input, operationId: operationId(), ...extra } });
      assert.equal(response.statusCode, 400, response.body);
    }
    await ctx.app.inject({ method: 'POST', url: `/v1/groups/${ctx.groupId}/leave`, headers: auth(ctx.third.token) });
    assert.equal((await ctx.app.inject({ method: 'POST', url: ctx.url, headers: auth(ctx.owner.token), payload: ctx.input })).statusCode, 400);
    assert.equal((ctx.db.prepare('SELECT COUNT(*) AS count FROM shared_expenses').get() as { count: number }).count, 0);
    assert.equal((ctx.db.prepare('SELECT COUNT(*) AS count FROM expense_participants').get() as { count: number }).count, 0);
  } finally { await ctx.close(); }
});

test('expenses: only own share can settle; version conflicts and retry preserve atomic ledger', async () => {
  const ctx = await household();
  try {
    const created = await ctx.app.inject({ method: 'POST', url: ctx.url, headers: auth(ctx.owner.token), payload: ctx.input });
    const expense = created.json().expense, settleUrl = `${ctx.url}/${expense.id}/settle`;
    const input = { operationId: operationId('settle'), expectedVersion: 1 };
    const settle = (token: string, payload: object) => ctx.app.inject({ method: 'POST', url: settleUrl, headers: auth(token), payload });
    assert.equal((await settle(ctx.owner.token, input)).statusCode, 403);
    assert.equal((await settle(ctx.member.token, { ...input, uid: ctx.third.uid })).statusCode, 400);
    const first = await settle(ctx.member.token, input);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().expense.version, 2);
    assert.deepEqual(first.json().expense.settledUids, [ctx.owner.uid, ctx.member.uid].sort());
    assert.deepEqual((await settle(ctx.member.token, input)).json(), first.json());
    assert.equal((await settle(ctx.third.token, { ...input, operationId: operationId() })).statusCode, 409);
    const last = await settle(ctx.third.token, { operationId: operationId(), expectedVersion: 2 });
    assert.equal(last.statusCode, 200);
    assert.equal(last.json().expense.version, 3);
    assert.deepEqual(last.json().expense.settledUids, [...ctx.input.participantUids].sort());
    // Exact replay returns the original response even after another user's update.
    assert.deepEqual((await settle(ctx.member.token, input)).json(), first.json());
    assert.equal((await settle(ctx.member.token, { ...input, expectedVersion: 3 })).statusCode, 409);
    await ctx.app.inject({ method: 'POST', url: `/v1/groups/${ctx.groupId}/leave`, headers: auth(ctx.member.token) });
    assert.equal((await settle(ctx.member.token, input)).statusCode, 404);
    assert.equal(integrityCheck(ctx.db), 'ok');
  } finally { await ctx.close(); }
});

test('expenses: nonparticipant cannot settle and zero-cent shares are already settled', async () => {
  const ctx = await household();
  try {
    const create = await ctx.app.inject({ method: 'POST', url: ctx.url, headers: auth(ctx.owner.token),
      payload: { ...ctx.input, amountCents: 1, participantUids: [ctx.owner.uid, ctx.member.uid] } });
    const expense = create.json().expense;
    assert.equal(expense.shares.reduce((sum: number, share: { amountCents: number }) => sum + share.amountCents, 0), 1);
    for (const share of expense.shares) if (share.amountCents === 0) assert.ok(expense.settledUids.includes(share.uid));
    const response = await ctx.app.inject({ method: 'POST', url: `${ctx.url}/${expense.id}/settle`, headers: auth(ctx.third.token),
      payload: { operationId: operationId(), expectedVersion: 1 } });
    assert.equal(response.statusCode, 403);
  } finally { await ctx.close(); }
});

test('expenses: concurrent settlements reject stale version and operation IDs bind group scope', async () => {
  const ctx = await household();
  try {
    const created = await ctx.app.inject({ method: 'POST', url: ctx.url, headers: auth(ctx.owner.token), payload: ctx.input });
    const expense = created.json().expense;
    const attempts = await Promise.all([ctx.member, ctx.third].map(user => ctx.app.inject({
      method: 'POST', url: `${ctx.url}/${expense.id}/settle`, headers: auth(user.token),
      payload: { operationId: operationId(), expectedVersion: 1 },
    })));
    assert.deepEqual(attempts.map(response => response.statusCode).sort(), [200, 409]);
    const list = await ctx.app.inject({ method: 'GET', url: ctx.url, headers: auth(ctx.owner.token) });
    assert.equal(list.json().expenses[0].version, 2);
    assert.equal(list.json().expenses[0].settledUids.length, 2);

    const group2 = await createGroup(ctx.app, ctx.owner, 'Segunda casa');
    await inviteAndJoin(ctx.app, ctx.owner, group2, ctx.member);
    await inviteAndJoin(ctx.app, ctx.owner, group2, ctx.third);
    const crossGroup = await ctx.app.inject({ method: 'POST', url: `/v1/groups/${group2}/expenses`,
      headers: auth(ctx.owner.token), payload: ctx.input });
    assert.equal(crossGroup.statusCode, 409);
    assert.equal((ctx.db.prepare('SELECT COUNT(*) AS count FROM shared_expenses').get() as { count: number }).count, 1);
  } finally { await ctx.close(); }
});

test('expenses migration upgrades schema 4 without modifying existing households or task data', async () => {
  const ctx = await setupTest();
  const legacy = join(ctx.dir, 'legacy-migrations');
  mkdirSync(legacy);
  for (const file of ['001_init.sql', '002_product_integration.sql', '003_task_details.sql', '004_google_calendar.sql'])
    copyFileSync(join(findMigrationsDir(), file), join(legacy, file));
  const db = openDatabase(join(ctx.dir, 'schema4.db'));
  try {
    migrate(db, legacy);
    db.exec(`INSERT INTO users(id,email,password_hash,display_name,device_epoch,created_at_epoch_ms,updated_at_epoch_ms)
      VALUES('old-user','old@example.test','hash','Legacy',0,1,1);
      INSERT INTO groups(id,name,time_zone,created_by,created_at_epoch_ms,updated_at_epoch_ms)
      VALUES('old-group','Casa anterior','Europe/Madrid','old-user',1,1);
      INSERT INTO tasks(id,group_id,title,status,version,created_at_epoch_ms,updated_at_epoch_ms,created_by_uid,description,category)
      VALUES('old-task','old-group','Comprar pan','PENDING',1,1,1,'old-user','Integral','Compra');`);
    const before = db.prepare('SELECT * FROM tasks').all();
    assert.deepEqual(migrate(db).applied.map(m => m.version), [5, 6, 7, 8, 9]);
    assert.deepEqual(db.prepare('SELECT * FROM tasks').all(), before.map(row => ({ ...(row as object), assignment_decision: 'not_required' })));
    assert.equal((db.prepare('SELECT name FROM groups').get() as { name: string }).name, 'Casa anterior');
    assert.equal(integrityCheck(db), 'ok');
    assert.equal(migrate(db).applied.length, 0);
  } finally { db.close(); await ctx.close(); }
});

test('expenses: selected debtors can exclude payer, deadline persists and retry binds the deadline', async () => {
  const ctx = await household();
  try {
    const payload = { ...ctx.input, participantUids: [ctx.member.uid, ctx.third.uid], amountCents: 101, dueDate: '2028-02-29' };
    const create = () => ctx.app.inject({ method: 'POST', url: ctx.url, headers: auth(ctx.owner.token), payload });
    const response = await create();
    assert.equal(response.statusCode, 200, response.body);
    const expense = response.json().expense;
    assert.equal(expense.paidByUid, ctx.owner.uid);
    assert.equal(expense.dueDate, '2028-02-29');
    assert.deepEqual(expense.participantUids, [...payload.participantUids].sort());
    assert.deepEqual(expense.shares.map((share: { amountCents: number }) => share.amountCents), [51, 50]);
    assert.deepEqual(expense.settledUids, []);
    assert.deepEqual((await create()).json(), response.json());
    const conflict = await ctx.app.inject({ method: 'POST', url: ctx.url, headers: auth(ctx.owner.token), payload: { ...payload, dueDate: '2028-03-01' } });
    assert.equal(conflict.statusCode, 409);
    const settled = await ctx.app.inject({ method: 'POST', url: `${ctx.url}/${expense.id}/settle`, headers: auth(ctx.member.token), payload: { operationId: operationId(), expectedVersion: 1 } });
    assert.equal(settled.statusCode, 200, settled.body);
    assert.equal(settled.json().expense.dueDate, payload.dueDate);
    assert.deepEqual(settled.json().expense.settledUids, [ctx.member.uid]);
    const list = await ctx.app.inject({ method: 'GET', url: ctx.url, headers: auth(ctx.owner.token) });
    assert.deepEqual(list.json().expenses, [settled.json().expense]);
  } finally { await ctx.close(); }
});

test('expense deadline migration preserves existing expenses and settlements without inventing a deadline', async () => {
  const ctx = await setupTest();
  const legacy = join(ctx.dir, 'schema5-migrations');
  mkdirSync(legacy);
  for (const file of ['001_init.sql', '002_product_integration.sql', '003_task_details.sql', '004_google_calendar.sql', '005_shared_expenses.sql'])
    copyFileSync(join(findMigrationsDir(), file), join(legacy, file));
  const db = openDatabase(join(ctx.dir, 'schema5.db'));
  try {
    migrate(db, legacy);
    db.exec(`INSERT INTO users(id,email,password_hash,display_name,device_epoch,created_at_epoch_ms,updated_at_epoch_ms)
      VALUES('old-user','old@example.test','hash','Legacy',0,1,1);
      INSERT INTO groups(id,name,time_zone,created_by,created_at_epoch_ms,updated_at_epoch_ms)
      VALUES('old-group','Casa anterior','Europe/Madrid','old-user',1,1);
      INSERT INTO shared_expenses(id,group_id,title,amount_cents,paid_by_uid,version,created_at_epoch_ms)
      VALUES('old-expense','old-group','Pan',123,'old-user',2,1);
      INSERT INTO expense_participants(expense_id,uid,share_cents,settled_at_epoch_ms)
      VALUES('old-expense','old-user',123,2);`);
    const participants = db.prepare('SELECT * FROM expense_participants').all();
    assert.deepEqual(migrate(db).applied.map(m => m.version), [6, 7, 8, 9]);
    assert.deepEqual(db.prepare('SELECT title,amount_cents,version,due_date FROM shared_expenses').get(), { title: 'Pan', amount_cents: 123, version: 2, due_date: null });
    assert.deepEqual(db.prepare('SELECT * FROM expense_participants').all(), participants);
    assert.equal(integrityCheck(db), 'ok');
  } finally { db.close(); await ctx.close(); }
});
