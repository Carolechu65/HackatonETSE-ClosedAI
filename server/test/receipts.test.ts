import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { auth, createGroup, inviteAndJoin, operationId, registerUser, setupTest } from './helpers.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCuoAAAAASUVORK5CYII=', 'base64');
const upload = { filename: 'ticket.png', base64: png.toString('base64') };
async function household(options: Parameters<typeof setupTest>[0] = {}) {
  const ctx = await setupTest(options);
  const owner = await registerUser(ctx.app, 'Pagador');
  const member = await registerUser(ctx.app, 'Participante');
  const outsider = await registerUser(ctx.app, 'Otro piso');
  const groupId = await createGroup(ctx.app, owner);
  await inviteAndJoin(ctx.app, owner, groupId, member);
  return { ...ctx, owner, member, outsider, groupId, url: `/v1/groups/${groupId}/receipts`, expenses: `/v1/groups/${groupId}/expenses` };
}
async function awaitStatus(ctx: Awaited<ReturnType<typeof household>>, id: string, status: string) {
  for (let i = 0; i < 150; i++) {
    const response = await ctx.app.inject({ method: 'GET', url: `${ctx.url}/${id}`, headers: auth(ctx.owner.token) });
    if (response.json().receipt.status === status) return response.json().receipt;
    await delay(20);
  }
  assert.fail(`Receipt did not reach ${status}`);
}

test('receipts: every route authenticates, isolates groups and revokes access on leaving', async () => {
  const ctx = await household();
  try {
    const created = await ctx.app.inject({ method: 'POST', url: ctx.url, headers: auth(ctx.owner.token), payload: upload });
    assert.equal(created.statusCode, 200, created.body);
    const id = created.json().receipt.id;
    const routes = [
      { method: 'GET' as const, url: ctx.url },
      { method: 'POST' as const, url: ctx.url, payload: upload },
      ...['', '/image', '/preview'].map(suffix => ({ method: 'GET' as const, url: `${ctx.url}/${id}${suffix}` })),
      { method: 'POST' as const, url: `${ctx.url}/${id}/retry`, payload: {} },
    ];
    for (const token of [undefined, ctx.outsider.token]) {
      for (const route of routes) {
        const response = await ctx.app.inject({ ...route, headers: token ? auth(token) : {} });
        assert.equal(response.statusCode, token ? 404 : 401, response.body);
        assert.ok(!response.body.includes(upload.base64));
      }
    }
    const group2 = await createGroup(ctx.app, ctx.owner);
    for (const suffix of ['', '/image', '/preview']) {
      const wrong = await ctx.app.inject({ method: 'GET', url: `/v1/groups/${group2}/receipts/${id}${suffix}`, headers: auth(ctx.owner.token) });
      assert.equal(wrong.statusCode, 404, wrong.body);
    }
    const image = await ctx.app.inject({ method: 'GET', url: `${ctx.url}/${id}/image`, headers: auth(ctx.owner.token) });
    assert.equal(image.statusCode, 200);
    assert.deepEqual(image.rawPayload, png);
    assert.equal(image.headers['content-type'], 'image/png');
    assert.equal(image.headers['cache-control'], 'no-store');
    const preview = await ctx.app.inject({ method: 'GET', url: `${ctx.url}/${id}/preview`, headers: auth(ctx.owner.token) });
    assert.deepEqual(preview.json(), { mediaType: 'image/png', base64: upload.base64 });
    for (const suffix of ['', '/image', '/preview']) {
      const privateDraft = await ctx.app.inject({ method: 'GET', url: `${ctx.url}/${id}${suffix}`, headers: auth(ctx.member.token) });
      assert.equal(privateDraft.statusCode, 404, privateDraft.body);
    }
    assert.equal((await ctx.app.inject({ method: 'POST', url: `${ctx.url}/${id}/retry`, headers: auth(ctx.member.token), payload: {} })).statusCode, 403);
    await ctx.app.inject({ method: 'POST', url: `/v1/groups/${ctx.groupId}/leave`, headers: auth(ctx.member.token) });
    assert.equal((await ctx.app.inject({ method: 'GET', url: `${ctx.url}/${id}/image`, headers: auth(ctx.member.token) })).statusCode, 404);
  } finally { await ctx.close(); }
});

test('receipts: validate real media signatures and decoded size, deduplicate per uploader and group', async () => {
  const ctx = await household();
  try {
    const send = (payload: object, token = ctx.owner.token, url = ctx.url) => ctx.app.inject({ method: 'POST', url, headers: auth(token), payload });
    const oversize = Buffer.alloc(8 * 1024 * 1024 + 1); png.copy(oversize);
    for (const base64 of ['', '%%%=', 'YWJj', png.toString('base64').slice(1), Buffer.from('<html>not an image</html>').toString('base64'), oversize.toString('base64')]) {
      const response = await send({ ...upload, base64 });
      assert.equal(response.statusCode, 400, response.body);
    }
    assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM expense_receipts').get() as { n: number }).n, 0);
    const first = await send(upload);
    const id = first.json().receipt.id;
    assert.equal(first.json().receipt.status, 'failed');
    assert.equal((await send({ ...upload, filename: 'renamed.pdf' })).json().receipt.id, id);
    const otherUser = await send(upload, ctx.member.token);
    assert.notEqual(otherUser.json().receipt.id, id);
    const group2 = await createGroup(ctx.app, ctx.owner);
    assert.notEqual((await send(upload, ctx.owner.token, `/v1/groups/${group2}/receipts`)).json().receipt.id, id);
    const list = await ctx.app.inject({ method: 'GET', url: ctx.url, headers: auth(ctx.owner.token) });
    assert.deepEqual(list.json().receipts.map((r: { id: string }) => r.id), [id]);
    for (const [bytes, mediaType, extension] of [
      [Buffer.from([255,216,255,224,0,16,74,70,73,70,0]), 'image/jpeg', '.jpg'],
      [Buffer.from('%PDF-1.7\n%%EOF\n'), 'application/pdf', '.pdf'],
    ] as const) {
      const response = await send({ filename: '../../ticket.exe', base64: bytes.toString('base64') });
      assert.equal(response.statusCode, 200, response.body);
      assert.ok(response.json().receipt.filename.endsWith(extension));
      assert.ok(!response.json().receipt.filename.includes('/'));
      const image = await ctx.app.inject({ method: 'GET', url: `${ctx.url}/${response.json().receipt.id}/image`, headers: auth(ctx.owner.token) });
      assert.equal(image.headers['content-type'], mediaType);
    }
  } finally { await ctx.close(); }
});

test('receipts: OCR runs asynchronously with private service credentials and preserves editable extraction', async () => {
  let release!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  let calls = 0;
  const ctx = await household({ receiptConfig: { url: 'http://ocr.internal', token: 'internal-secret' }, receiptFetch: async (url, init) => {
    calls++;
    assert.equal(url, 'http://ocr.internal/extract');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer internal-secret');
    assert.deepEqual(Buffer.from(init?.body as Uint8Array), png);
    return pending;
  } });
  try {
    const response = await ctx.app.inject({ method: 'POST', url: ctx.url, headers: auth(ctx.owner.token), payload: upload });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().receipt.status, 'reading');
    const duplicate = await ctx.app.inject({ method: 'POST', url: ctx.url, headers: auth(ctx.owner.token), payload: upload });
    assert.equal(duplicate.json().receipt.id, response.json().receipt.id);
    assert.equal(calls, 1);
    const result = { fields: { merchant: 'Mercado', amountCents: 1299, purchasedOn: '2026-10-22' }, warnings: ['Revisa el total'] };
    release(new Response(JSON.stringify(result)));
    assert.deepEqual((await awaitStatus(ctx, response.json().receipt.id, 'ready')).result, result);
    const expenses = await ctx.app.inject({ method: 'GET', url: ctx.expenses, headers: auth(ctx.owner.token) });
    assert.deepEqual(expenses.json().expenses, []);
  } finally { release(new Response('{}')); await ctx.close(); }
});

test('receipts: failed OCR can be retried by its uploader without reuploading the original', async () => {
  let calls = 0;
  const ctx = await household({ receiptConfig: { url: 'http://ocr.internal', token: 'secret' }, receiptFetch: async () => {
    calls++;
    return calls === 1 ? new Response('unavailable', { status: 503 }) : new Response(JSON.stringify({ fields: { merchant: 'Recuperado' } }));
  } });
  try {
    const response = await ctx.app.inject({ method: 'POST', url: ctx.url, headers: auth(ctx.owner.token), payload: upload });
    const id = response.json().receipt.id;
    await awaitStatus(ctx, id, 'failed');
    const retry = await ctx.app.inject({ method: 'POST', url: `${ctx.url}/${id}/retry`, headers: auth(ctx.owner.token), payload: {} });
    assert.equal(retry.statusCode, 200, retry.body);
    assert.equal((await awaitStatus(ctx, id, 'ready')).result.fields.merchant, 'Recuperado');
    assert.equal(calls, 2);
  } finally { await ctx.close(); }
});

test('receipt expenses: attachment ownership, group scope and duplicate expense protection are atomic', async () => {
  const ctx = await household();
  try {
    const receipt = (await ctx.app.inject({ method: 'POST', url: ctx.url, headers: auth(ctx.owner.token), payload: upload })).json().receipt;
    const input = { operationId: operationId(), title: 'Compra revisada', amountCents: 1234, participantUids: [ctx.owner.uid, ctx.member.uid], receiptId: receipt.id,
      merchant: 'Mercado', purchasedOn: '2026-10-22', category: 'Compra', notes: 'Revisado a mano' };
    const create = (payload: object, token = ctx.owner.token, url = ctx.expenses) => ctx.app.inject({ method: 'POST', url, headers: auth(token), payload });
    assert.equal((await create(input, ctx.member.token)).statusCode, 404);
    const group2 = await createGroup(ctx.app, ctx.owner);
    assert.equal((await create({ ...input, participantUids: [ctx.owner.uid] }, ctx.owner.token, `/v1/groups/${group2}/expenses`)).statusCode, 404);
    const response = await create(input);
    assert.equal(response.statusCode, 200, response.body);
    for (const key of ['receiptId', 'merchant', 'purchasedOn', 'category', 'notes'] as const) assert.equal(response.json().expense[key], input[key]);
    const sharedReceipt = await ctx.app.inject({ method: 'GET', url: `${ctx.url}/${receipt.id}`, headers: auth(ctx.member.token) });
    assert.equal(sharedReceipt.statusCode, 200, sharedReceipt.body);
    const sharedImage = await ctx.app.inject({ method: 'GET', url: `${ctx.url}/${receipt.id}/image`, headers: auth(ctx.member.token) });
    assert.deepEqual(sharedImage.rawPayload, png);
    const sharedPreview = await ctx.app.inject({ method: 'GET', url: `${ctx.url}/${receipt.id}/preview`, headers: auth(ctx.member.token) });
    assert.deepEqual(sharedPreview.json(), { mediaType: 'image/png', base64: upload.base64 });
    const reuploaded = await ctx.app.inject({ method: 'POST', url: ctx.url, headers: auth(ctx.owner.token), payload: upload });
    assert.equal(reuploaded.statusCode, 200, reuploaded.body);
    assert.equal(reuploaded.json().receipt.id, receipt.id);
    assert.equal(reuploaded.json().existingExpenseId, response.json().expense.id);
    assert.deepEqual((await create(input)).json(), response.json());
    assert.equal((await create({ ...input, operationId: operationId() })).statusCode, 409);
    const pending = await ctx.app.inject({ method: 'GET', url: ctx.url, headers: auth(ctx.owner.token) });
    assert.deepEqual(pending.json().receipts, []);
    assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM shared_expenses').get() as { n: number }).n, 1);
    const detach = await ctx.app.inject({ method: 'POST', url: `${ctx.expenses}/${response.json().expense.id}/update`, headers: auth(ctx.owner.token),
      payload: { ...input, operationId: operationId(), expectedVersion: 1, receiptId: undefined } });
    assert.equal(detach.statusCode, 400, detach.body);
    assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM expense_revisions').get() as { n: number }).n, 0);
  } finally { await ctx.close(); }
});

test('expense edits: exact and percentage splits, versioning, audit history and settled debts stay consistent', async () => {
  const ctx = await household();
  try {
    const input = { operationId: operationId(), title: 'Compra', amountCents: 101, participantUids: [ctx.owner.uid, ctx.member.uid],
      split: { mode: 'exact', values: [{ uid: ctx.owner.uid, value: 41 }, { uid: ctx.member.uid, value: 60 }] } };
    const created = await ctx.app.inject({ method: 'POST', url: ctx.expenses, headers: auth(ctx.owner.token), payload: input });
    assert.equal(created.statusCode, 200, created.body);
    const expense = created.json().expense;
    assert.equal(expense.shares.find((s: { uid: string }) => s.uid === ctx.member.uid).amountCents, 60);
    const url = `${ctx.expenses}/${expense.id}/update`;
    const update = { ...input, operationId: operationId(), expectedVersion: 1, amountCents: 100, title: 'Compra corregida',
      split: { mode: 'percentage', values: [{ uid: ctx.owner.uid, value: 2500 }, { uid: ctx.member.uid, value: 7500 }] } };
    const edit = (payload: object, token = ctx.owner.token) => ctx.app.inject({ method: 'POST', url, headers: auth(token), payload });
    assert.equal((await edit(update, ctx.member.token)).statusCode, 403);
    assert.equal((await edit(update, ctx.outsider.token)).statusCode, 404);
    assert.equal((await ctx.app.inject({ method: 'POST', url, payload: update })).statusCode, 401);
    const changed = await edit(update);
    assert.equal(changed.statusCode, 200, changed.body);
    assert.equal(changed.json().expense.version, 2);
    assert.equal(changed.json().expense.shares.find((s: { uid: string }) => s.uid === ctx.member.uid).amountCents, 75);
    assert.deepEqual((await edit(update)).json(), changed.json());
    assert.equal((await edit({ ...update, operationId: operationId() })).statusCode, 409);
    const revisions = ctx.db.prepare('SELECT version,previous_json FROM expense_revisions WHERE expense_id=?').all(expense.id) as Array<{ version: number; previous_json: string }>;
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0]?.version, 1);
    assert.deepEqual(JSON.parse(revisions[0]!.previous_json), expense);
    const settled = await ctx.app.inject({ method: 'POST', url: `${ctx.expenses}/${expense.id}/settle`, headers: auth(ctx.member.token), payload: { operationId: operationId(), expectedVersion: 2 } });
    assert.equal(settled.statusCode, 200, settled.body);
    assert.equal((await edit({ ...update, operationId: operationId(), expectedVersion: 3, amountCents: 200 })).statusCode, 409);
    assert.deepEqual((await edit(update)).json(), changed.json());
    const list = await ctx.app.inject({ method: 'GET', url: ctx.expenses, headers: auth(ctx.owner.token) });
    assert.deepEqual(list.json().expenses, [settled.json().expense]);
  } finally { await ctx.close(); }
});

test('receipt expenses: malformed split input cannot partially write a ledger or revision', async () => {
  const ctx = await household();
  try {
    const input = { operationId: operationId(), title: 'Compra', amountCents: 100, participantUids: [ctx.owner.uid, ctx.member.uid] };
    const create = (payload: object) => ctx.app.inject({ method: 'POST', url: ctx.expenses, headers: auth(ctx.owner.token), payload });
    const created = await create(input);
    assert.equal(created.statusCode, 200, created.body);
    const expense = created.json().expense;
    for (const split of [null, {}, { mode: 'unknown' }, { mode: 'exact', values: [null, null] },
      { mode: 'exact', values: [{ uid: ctx.owner.uid, value: 30 }, { uid: ctx.member.uid, value: 60 }] },
      { mode: 'percentage', values: [{ uid: ctx.owner.uid, value: 50 }, { uid: ctx.member.uid, value: 50 }] }]) {
      const payload = { ...input, operationId: operationId(), split };
      const rejected = await create(payload);
      assert.equal(rejected.statusCode, 400, rejected.body);
      const edit = await ctx.app.inject({ method: 'POST', url: `${ctx.expenses}/${expense.id}/update`, headers: auth(ctx.owner.token), payload: { ...payload, expectedVersion: 1 } });
      assert.equal(edit.statusCode, 400, edit.body);
    }
    assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM shared_expenses').get() as { n: number }).n, 1);
    assert.equal((ctx.db.prepare('SELECT COUNT(*) AS n FROM expense_revisions').get() as { n: number }).n, 0);
    const list = await ctx.app.inject({ method: 'GET', url: ctx.expenses, headers: auth(ctx.owner.token) });
    assert.deepEqual(list.json().expenses, [expense]);
  } finally { await ctx.close(); }
});

test('receipts: malformed, oversized and unavailable OCR responses leave a retryable original', async () => {
  for (const response of [new Response('not json'), new Response('{}'), new Response('x'.repeat(200001)), new Response('unavailable', { status: 503 })]) {
    const ctx = await household({ receiptConfig: { url: 'http://ocr.internal', token: 'secret' }, receiptFetch: async () => response });
    try {
      const uploaded = await ctx.app.inject({ method: 'POST', url: ctx.url, headers: auth(ctx.owner.token), payload: upload });
      const id = uploaded.json().receipt.id;
      const failed = await awaitStatus(ctx, id, 'failed');
      assert.equal(failed.result, undefined);
      const original = await ctx.app.inject({ method: 'GET', url: `${ctx.url}/${id}/image`, headers: auth(ctx.owner.token) });
      assert.deepEqual(original.rawPayload, png);
    } finally { await ctx.close(); }
  }
});
