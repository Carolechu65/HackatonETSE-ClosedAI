import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTest, registerUser, createGroup, inviteAndJoin, auth } from './helpers.ts';
import { randomBytes } from 'node:crypto';
import { parseCreateAlarmRequest } from '../../src/domain/contracts/validate.ts';
test(
  'OpenRouter real through canonical agent and normalized chat alias',
  { skip: process.env.RUN_LIVE_AGENT !== 'true' },
  async () => {
    const apiKey = process.env.AI_TEST_API_KEY;
    assert.ok(apiKey, 'Configure a private AI_TEST_API_KEY');
    const ctx = await setupTest({ config: { aiCredentialKey: randomBytes(32), agent: { provider: 'none', baseUrl: null, apiKey: null, model: null, timeoutMs: 30000, sessionTtlMs: 1800000 } }, fileDatabase: true });
    try {
      const a = await registerUser(ctx.app, 'Emisor sintético'),
        b = await registerUser(ctx.app, 'Ana');
      const input = { provider: process.env.AI_TEST_PROVIDER ?? 'openrouter', model: process.env.AI_TEST_MODEL ?? 'deepseek/deepseek-v4.1-flash', apiKey };
      const probe = await ctx.app.inject({ method: 'POST', url: '/v1/ai/connection/test', headers: auth(a.token), payload: input });
      assert.equal(probe.statusCode, 200, probe.body);
      const saved = await ctx.app.inject({ method: 'POST', url: '/v1/ai/connection/save', headers: auth(a.token), payload: { ...input, testToken: probe.json().testToken } });
      assert.equal(saved.statusCode, 200, saved.body);
      const groupId = await createGroup(ctx.app, a, 'Piso sintético');
      await inviteAndJoin(ctx.app, a, groupId, b);
      const first = await ctx.app.inject({
        method: 'POST',
        url: '/v1/agent/draft',
        headers: auth(a.token),
        payload: { groupId, text: 'Recuérdale a Ana sacar la basura cuando vuelva' },
      });
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().status, 'needs_clarification');
      const second = await ctx.app.inject({
        method: 'POST',
        url: '/v1/agent/draft',
        headers: auth(a.token),
        payload: {
          groupId,
          text: 'El 23 de octubre de 2027 a las 18:30 de Madrid, como NOTIFICATION. La destinataria es Ana.',
          conversationId: first.json().conversationId,
        },
      });
      assert.equal(second.statusCode, 200, second.body);
      assert.equal(second.json().status, 'draft');
      assert.deepEqual(second.json().draft.recipientUids, [b.uid]);
      assert.equal(second.json().requiresRecipientConsent, true);
      parseCreateAlarmRequest({
        schemaVersion: 1,
        operationId: 'validate-live',
        groupId,
        payload: second.json().draft,
      });
      assert.equal(
        (ctx.db.prepare('SELECT count(*) AS n FROM alarm_requests').get() as { n: number }).n,
        0,
      );
    } finally {
      await ctx.close();
    }
  },
);
