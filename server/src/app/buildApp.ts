import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { DomainError } from '../../../src/domain/errors.ts';
import { authenticate, loginUser, publicProfile, registerUser, revokeSession, sessionInfo, type AuthUser } from '../auth/service.ts';
import type { ServerConfig } from '../config.ts';
import { createInvitation, acceptInvitation, readToken } from '../groups/invitations.ts';
import {
  createGroup,
  leaveGroup,
  listGroups,
  listMembers,
  removeMember,
} from '../groups/service.ts';
import { FixedWindowLimiter } from '../lib/rateLimit.ts';
import { normalizeEmail, readIdentifier, readPassword, readString, asRecord } from '../lib/validation.ts';
import { assertSchemaReady, type Db } from '../persistence/db.ts';
import { listAlarmRequests, listSchedules, readAlarmRequest } from '../operations/queries.ts';
import { executeOperation, isOperationName } from '../operations/execute.ts';
import { acknowledgeReception, readSnapshot, readSyncPage } from '../sync/service.ts';
import { registerDevice, setPrimaryDevice } from '../devices/service.ts';
import { proposeAlarm } from '../agents/service.ts';
import type { AgentProvider } from '../agents/types.ts';
import { installErrorHandler } from './errors.ts';
import { listAlarmRecords, readAlarmProjection } from '../compat/alarms.ts';
import { createTask, listTasks, updateTask } from '../tasks/service.ts';

export type BuildAppOptions = {
  config: ServerConfig;
  db: Db;
  logger?: boolean;
  agentProvider?: AgentProvider;
};

function authHeader(request: FastifyRequest): string | string[] | undefined {
  return request.headers.authorization;
}

function requireAuth(db: Db, request: FastifyRequest): AuthUser {
  return authenticate(db, authHeader(request));
}

function queryInt(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new DomainError('INVALID_ARGUMENT', 'Parámetro numérico no válido.');
  }
  return Number(value);
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const { config, db } = options;
  assertSchemaReady(db);

  const app = Fastify({
    logger: options.logger === false ? false : {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      serializers: {
        req(request: { method: string; url: string }) {
          return { method: request.method, url: request.url.replace(/(\/v1\/invitations\/)[^/]+(\/accept)/, '$1[REDACTED]$2').split('?')[0] };
        },
      },
    },
    bodyLimit: config.bodyLimitBytes,
    trustProxy: config.trustProxy,
  });

  installErrorHandler(app);

  // Acepta POST sin cuerpo (logout, aceptar invitación, marcar principal):
  // clientes reales no siempre envían content-type. JSON vacío = sin cuerpo.
  app.addHook('onRequest', async (request) => {
    if (!request.headers['content-type'] && ['POST', 'PUT', 'PATCH'].includes(request.method)) {
      request.headers['content-type'] = 'application/json';
    }
  });
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    if (typeof body !== 'string' || body.trim() === '') {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch {
      done(Object.assign(new Error('JSON no válido'), { statusCode: 400, code: 'FST_ERR_CTP_INVALID_JSON_BODY' }));
    }
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    if (request.headers.origin && config.corsOrigins.includes(request.headers.origin)) { reply.header('access-control-allow-origin', request.headers.origin); reply.header('vary', 'Origin'); }
    reply.header('access-control-allow-headers', 'content-type, authorization');
    reply.header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  });

  app.options('/*', async (_request, reply) => reply.status(204).send());

  const authLimiter = new FixedWindowLimiter(config.authRateLimit.max, config.authRateLimit.windowMs);
  const operationLimiter = new FixedWindowLimiter(config.operationRateLimit.max, config.operationRateLimit.windowMs);
  const agentLimiter = new FixedWindowLimiter(config.agentRateLimit.max, config.agentRateLimit.windowMs);

  app.get('/health', async () => ({
    status: 'ok',
    service: 'alarmat-server',
    schemaVersion: (db.pragma('user_version', { simple: true }) as number) ?? 1,
    serverTimeEpochMs: Date.now(),
  }));

  app.post('/v1/auth/register', async (request, reply) => {
    authLimiter.check(`register:${request.ip}`);
    const body = asRecord(request.body);
    const session = await registerUser(db, config, {
      email: normalizeEmail(body.email),
      password: readPassword(body.password),
      displayName: readString(body.displayName, 'body.displayName', { max: 80 }),
    });
    return reply.status(201).send(session);
  });

  app.post('/v1/auth/login', async (request) => {
    authLimiter.check(`login:${request.ip}`);
    const body = asRecord(request.body);
    return loginUser(db, config, {
      email: normalizeEmail(body.email),
      password: readPassword(body.password),
    });
  });

  app.get('/v1/auth/me', async (request) => {
    const actor = requireAuth(db, request);
    return { user: publicProfile(actor), session: sessionInfo(actor) };
  });

  app.post('/v1/auth/logout', async (request) => {
    const actor = requireAuth(db, request);
    revokeSession(db, actor.sessionId);
    return { ok: true };
  });

  app.get('/v1/groups', async (request) => {
    const actor = requireAuth(db, request);
    return { groups: listGroups(db, actor.uid) };
  });

  app.post('/v1/groups', async (request, reply) => {
    const actor = requireAuth(db, request);
    const body = asRecord(request.body);
    const group = createGroup(db, actor.uid, {
      name: readString(body.name, 'body.name', { max: 80 }),
      timeZone: readString(body.timeZone, 'body.timeZone', { max: 64 }),
    });
    return reply.status(201).send(group);
  });

  app.get('/v1/groups/:groupId/members', async (request) => {
    const actor = requireAuth(db, request);
    const params = request.params as { groupId: string };
    return { members: listMembers(db, actor.uid, readIdentifier(params.groupId, 'params.groupId')) };
  });

  app.post('/v1/groups/:groupId/invitations', async (request, reply) => {
    const actor = requireAuth(db, request);
    const params = request.params as { groupId: string };
    const body = asRecord(request.body ?? {});
    const invitation = createInvitation(
      db,
      actor.uid,
      readIdentifier(params.groupId, 'params.groupId'),
      {
        expiresInMs: body.expiresInMs === undefined ? undefined : Number(body.expiresInMs),
        role: body.role === undefined ? undefined : body.role as 'OWNER' | 'MEMBER',
      },
    );
    return reply.status(201).send(invitation);
  });

  app.post('/v1/invitations/:token/accept', async (request) => {
    const actor = requireAuth(db, request);
    const params = request.params as { token: string };
    return acceptInvitation(db, actor.uid, readToken(params.token));
  });

  app.delete('/v1/groups/:groupId/members/:uid', async (request) => {
    const actor = requireAuth(db, request);
    const params = request.params as { groupId: string; uid: string };
    removeMember(
      db,
      actor.uid,
      readIdentifier(params.groupId, 'params.groupId'),
      readIdentifier(params.uid, 'params.uid'),
    );
    return { ok: true };
  });

  app.post('/v1/groups/:groupId/leave', async (request) => {
    const actor = requireAuth(db, request);
    const params = request.params as { groupId: string };
    leaveGroup(db, actor.uid, readIdentifier(params.groupId, 'params.groupId'));
    return { ok: true };
  });

  app.post('/v1/operations/:operationName', async (request) => {
    const actor = requireAuth(db, request);
    operationLimiter.check(`operation:${actor.uid}`);
    const params = request.params as { operationName: string };
    if (!isOperationName(params.operationName)) {
      throw new DomainError('INVALID_ARGUMENT', 'Operación desconocida.');
    }
    return executeOperation(db, actor, params.operationName, request.body);
  });

  app.get('/v1/groups/:groupId/alarm-requests', async (request) => {
    const actor = requireAuth(db, request);
    const params = request.params as { groupId: string };
    const query = request.query as { limit?: string; offset?: string };
    const page = listAlarmRequests(
      db,
      actor.uid,
      readIdentifier(params.groupId, 'params.groupId'),
      {
        limit: queryInt(query.limit, 20),
        offset: queryInt(query.offset, 0),
      },
    );
    return { items: page.items, nextOffset: page.nextOffset };
  });

  app.get('/v1/groups/:groupId/alarm-requests/:requestId', async (request) => {
    const actor = requireAuth(db, request);
    const params = request.params as { groupId: string; requestId: string };
    return readAlarmRequest(
      db,
      actor.uid,
      readIdentifier(params.groupId, 'params.groupId'),
      readIdentifier(params.requestId, 'params.requestId'),
    );
  });

  app.get('/v1/groups/:groupId/alarm-requests/:requestId/schedules', async (request) => {
    const actor = requireAuth(db, request);
    const params = request.params as { groupId: string; requestId: string };
    return {
      schedules: listSchedules(
        db,
        actor.uid,
        readIdentifier(params.groupId, 'params.groupId'),
        readIdentifier(params.requestId, 'params.requestId'),
      ),
    };
  });

  app.get('/v1/sync', async (request) => {
    const actor = requireAuth(db, request);
    const query = request.query as { cursor?: string; limit?: string; projection?: string };
    if (query.projection === 'alarms') return readAlarmProjection(db,actor.uid,query.cursor??null,queryInt(query.limit,100));
    return readSyncPage(db, actor.uid, query.cursor ?? null, query.limit ? queryInt(query.limit, 50) : null);
  });

  app.get('/v1/snapshot', async (request) => {
    const actor = requireAuth(db, request);
    return readSnapshot(db, actor.uid);
  });

  app.post('/v1/alarms/:requestId/received', async (request) => {
    const actor = requireAuth(db, request);
    const params = request.params as { requestId: string };
    const body = asRecord(request.body);
    const requestVersion = Number(body.requestVersion);
    if (!Number.isSafeInteger(requestVersion) || requestVersion < 1) {
      throw new DomainError('INVALID_ARGUMENT', 'body.requestVersion: entero positivo.');
    }
    acknowledgeReception(db, actor.uid, readIdentifier(params.requestId, 'params.requestId'), requestVersion);
    return { ok: true };
  });

  app.post('/v1/devices', async (request, reply) => {
    const actor = requireAuth(db, request);
    const body = asRecord(request.body ?? {});
    const device = registerDevice(db, actor, body);
    return reply.status(201).send(device);
  });

  app.post('/v1/devices/:deviceId/primary', async (request) => {
    const actor = requireAuth(db, request);
    const params = request.params as { deviceId: string };
    return setPrimaryDevice(db, actor, { deviceId: params.deviceId });
  });

  app.post('/v1/agent/propose', async (request) => {
    const actor = requireAuth(db, request);
    agentLimiter.check(`agent:${actor.uid}`);
    return proposeAlarm(db, actor, request.body, config.agent, options.agentProvider);
  });


  app.get('/v1/groups/:groupId/alarms',async request=>{const actor=requireAuth(db,request);const {groupId}=request.params as {groupId:string};return listAlarmRecords(db,actor.uid,readIdentifier(groupId,'groupId'));});
  app.post('/v1/invitations/accept',async request=>{const actor=requireAuth(db,request);return acceptInvitation(db,actor.uid,readToken(asRecord(request.body).token));});
  app.route({method:['POST','PUT'],url:'/v1/devices/primary',handler:async request=>{const actor=requireAuth(db,request);return setPrimaryDevice(db,actor,{deviceId:asRecord(request.body).deviceId});}});
  app.get('/v1/groups/:groupId/tasks',async request=>{const actor=requireAuth(db,request);const {groupId}=request.params as {groupId:string};return listTasks(db,actor.uid,readIdentifier(groupId,'groupId'));});
  app.post('/v1/groups/:groupId/tasks',async request=>{const actor=requireAuth(db,request);operationLimiter.check(`task:${actor.uid}`);const {groupId}=request.params as {groupId:string};return createTask(db,actor.uid,readIdentifier(groupId,'groupId'),request.body);});
  app.route({method:['POST','PATCH'],url:'/v1/groups/:groupId/tasks/:taskId',handler:async request=>{const actor=requireAuth(db,request);operationLimiter.check(`task:${actor.uid}`);const {groupId,taskId}=request.params as {groupId:string;taskId:string};return updateTask(db,actor.uid,readIdentifier(groupId,'groupId'),readIdentifier(taskId,'taskId'),request.body);}});
  app.post('/v1/agent/draft',async request=>{const actor=requireAuth(db,request);agentLimiter.check(`agent:${actor.uid}`);const body=asRecord(request.body);if(Object.keys(body).some(key=>!['groupId','text','conversationId'].includes(key)))throw new DomainError('INVALID_ARGUMENT','Campos del asistente inválidos.');const result=await proposeAlarm(db,actor,{groupId:body.groupId,text:body.text,...(body.conversationId?{sessionId:body.conversationId}:{})},config.agent,options.agentProvider);requireAuth(db,request);if(result.status==='needs_clarification')return {conversationId:result.sessionId,status:result.status,question:result.question,missingFields:result.missingFields};return {conversationId:result.sessionId,status:'draft',draft:{title:result.draft.title,recipientUids:result.draft.recipientUids,timeSpec:result.draft.timeSpec,mode:result.draft.mode},requiresSenderReview:true,requiresRecipientConsent:true};});
  return app;
}
