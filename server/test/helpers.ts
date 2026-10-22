import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/buildApp.ts';
import { loadConfig, type ServerConfig } from '../src/config.ts';
import { migrate, openDatabase, type Db } from '../src/persistence/db.ts';
import type { AgentProvider } from '../src/agents/types.ts';

export type TestContext = {
  app: FastifyInstance;
  db: Db;
  config: ServerConfig;
  dir: string;
  close: () => Promise<void>;
};

export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const base = loadConfig({
    DATABASE_PATH: ':memory:',
    SESSION_TTL_MS: String(60 * 60 * 1000),
    AUTH_RATE_LIMIT: '1000',
    OPERATION_RATE_LIMIT: '5000',
    AGENT_RATE_LIMIT: '1000',
    ARGON2_MEMORY_KIB: '4096',
    ARGON2_TIME_COST: '1',
    AI_PROVIDER: 'deterministic',
  });
  return {
    ...base,
    ...overrides,
    databasePath: overrides.databasePath ?? ':memory:',
    argon2: overrides.argon2 ?? base.argon2,
    push: overrides.push ?? base.push,
    agent: overrides.agent ?? base.agent,
  };
}

export async function setupTest(options: {
  config?: Partial<ServerConfig>;
  agentProvider?: AgentProvider;
  fileDatabase?: boolean;
} = {}): Promise<TestContext> {
  const dir = mkdtempSync(join(tmpdir(), 'alarmat-test-'));
  const config = testConfig({
    ...options.config,
    ...(options.fileDatabase ? { databasePath: join(dir, 'alarmat.db') } : {}),
  });
  const db = openDatabase(config.databasePath);
  migrate(db);
  const app = buildApp({ config, db, logger: false, agentProvider: options.agentProvider });
  await app.ready();
  return {
    app,
    db,
    config,
    dir,
    close: async () => {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export type TestUser = {
  uid: string;
  email: string;
  token: string;
  displayName: string;
};

let counter = 0;

export async function registerUser(app: FastifyInstance, displayName = 'Demo'): Promise<TestUser> {
  counter += 1;
  const email = `user${counter}-${Date.now()}@example.test`;
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: { email, password: 'correct horse battery staple', displayName },
  });
  if (response.statusCode !== 201) throw new Error(`register failed: ${response.statusCode} ${response.body}`);
  const body = response.json() as { token: string; user: { uid: string } };
  return { uid: body.user.uid, email, token: body.token, displayName };
}

export function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function createGroup(
  app: FastifyInstance,
  user: TestUser,
  name = 'Piso demo',
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/groups',
    headers: auth(user.token),
    payload: { name, timeZone: 'Europe/Madrid' },
  });
  if (response.statusCode !== 201) throw new Error(`group failed: ${response.statusCode} ${response.body}`);
  return (response.json() as { groupId: string }).groupId;
}

export async function inviteAndJoin(
  app: FastifyInstance,
  owner: TestUser,
  groupId: string,
  invitee: TestUser,
): Promise<void> {
  const invitation = await app.inject({
    method: 'POST',
    url: `/v1/groups/${groupId}/invitations`,
    headers: auth(owner.token),
    payload: {},
  });
  if (invitation.statusCode !== 201) throw new Error(`invite failed: ${invitation.body}`);
  const token = (invitation.json() as { token: string }).token;
  const accept = await app.inject({
    method: 'POST',
    url: `/v1/invitations/${token}/accept`,
    headers: auth(invitee.token),
  });
  if (accept.statusCode !== 200) throw new Error(`accept failed: ${accept.statusCode} ${accept.body}`);
}

export const FUTURE_TIME = {
  timeZone: 'Europe/Madrid',
  localDate: '2030-01-15',
  localTime: '21:00',
  effectiveAtEpochMs: Date.UTC(2030, 0, 15, 20, 0),
};

let operationCounter = 0;

export function operationId(prefix = 'op'): string {
  operationCounter += 1;
  return `${prefix}-${Date.now()}-${operationCounter}`;
}

export function createAlarmBody(options: {
  groupId: string;
  recipientUids: string[];
  operationId?: string;
  title?: string;
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    operationId: options.operationId ?? operationId('create'),
    groupId: options.groupId,
    payload: {
      title: options.title ?? 'Sacar la basura',
      note: 'La bolsa pesa, mejor bajar antes de las diez.',
      recipientUids: options.recipientUids,
      mode: 'ALARM',
      timeSpec: FUTURE_TIME,
    },
  };
}

export async function createAlarm(
  app: FastifyInstance,
  actor: TestUser,
  groupId: string,
  recipientUids: string[],
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/operations/createAlarmRequest',
    headers: auth(actor.token),
    payload: createAlarmBody({ groupId, recipientUids }),
  });
  if (response.statusCode !== 200) throw new Error(`create alarm failed: ${response.statusCode} ${response.body}`);
  return (response.json() as { result: { requestId: string } }).result.requestId;
}

export async function registerDevice(
  app: FastifyInstance,
  user: TestUser,
  pushToken?: string,
): Promise<{ deviceId: string; deviceEpoch: number }> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/devices',
    headers: auth(user.token),
    payload: { platform: 'android', pushToken },
  });
  if (response.statusCode !== 201) throw new Error(`device failed: ${response.body}`);
  return response.json() as { deviceId: string; deviceEpoch: number };
}
