import { DomainError } from '../../../src/domain/errors.ts';
import { parseCreateAlarmRequest } from '../../../src/domain/contracts/validate.ts';
import type { TimeSpec } from '../../../src/domain/contracts/types.ts';
import { wallClockInZone } from '../../../src/domain/time.ts';
import type { AuthUser } from '../auth/service.ts';
import { listMembers, requireActiveMembership } from '../groups/service.ts';
import { generateId } from '../lib/ids.ts';
import { readIdentifier, readString } from '../lib/validation.ts';
import type { Db } from '../persistence/db.ts';
import { readAlarmRequest } from '../operations/queries.ts';
import { DeterministicAgentProvider } from './deterministic.ts';
import { OpenAiCompatibleProvider } from './openai.ts';
import { AgentProviderError, type AgentContext, type AgentDraft, type AgentProvider } from './types.ts';

export type AgentConfig = {
  provider: 'none' | 'deterministic' | 'openai';
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  timeoutMs: number;
  sessionTtlMs: number;
};

export type AgentProposal =
  | {
      sessionId: string;
      provider: string;
      status: 'needs_clarification';
      question: string;
      missingFields: string[];
    }
  | {
      sessionId: string;
      provider: string;
      status: 'draft';
      draft: AgentDraft;
      requiresSenderReview: true;
      requiresRecipientConsent: true;
      note: string;
    };

type SessionRow = {
  id: string;
  owner_uid: string;
  group_id: string;
  status: 'OPEN' | 'COMPLETED' | 'EXPIRED';
  collected_json: string;
  expires_at_epoch_ms: number;
  turns: number;
};

export function createAgentProvider(config: AgentConfig): AgentProvider | null {
  if (config.provider === 'deterministic') return new DeterministicAgentProvider();
  if (config.provider === 'openai') {
    if (!config.baseUrl || !config.apiKey || !config.model) return null;
    return new OpenAiCompatibleProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      timeoutMs: config.timeoutMs,
    });
  }
  return null;
}

type ProposeInput = {
  groupId: string;
  text: string;
  sessionId?: string;
};

function readInput(value: unknown): ProposeInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainError('INVALID_ARGUMENT', 'body: se esperaba un objeto.');
  }
  const record = value as Record<string, unknown>;
  const allowed = ['groupId', 'text', 'sessionId'];
  const extra = Object.keys(record).filter((key) => !allowed.includes(key));
  if (extra.length > 0) throw new DomainError('INVALID_ARGUMENT', 'body: campos no permitidos.', { extra });
  const groupId = readIdentifier(record.groupId, 'body.groupId');
  const text = readString(record.text, 'body.text', { max: 2000 });
  const input: ProposeInput = { groupId, text };
  if (record.sessionId !== undefined) input.sessionId = readIdentifier(record.sessionId, 'body.sessionId');
  return input;
}

function readConversation(session: SessionRow | undefined): string[] {
  if (!session) return [];
  try {
    const parsed = JSON.parse(session.collected_json) as { conversation?: unknown };
    if (Array.isArray(parsed.conversation)) {
      return parsed.conversation.filter((item): item is string => typeof item === 'string').slice(-5);
    }
  } catch {
    return [];
  }
  return [];
}

type StoredSessionState = {
  conversation?: unknown;
  lastClarification?: unknown;
};

function readLastClarification(session: SessionRow | undefined): { question: string; missingFields: string[] } | undefined {
  if (!session) return undefined;
  try {
    const parsed = JSON.parse(session.collected_json) as StoredSessionState;
    const raw = parsed.lastClarification;
    if (raw === null || typeof raw !== 'object') return undefined;
    const record = raw as Record<string, unknown>;
    if (typeof record.question !== 'string' || !Array.isArray(record.missingFields)) return undefined;
    const missingFields = record.missingFields.filter((field): field is string => typeof field === 'string').slice(0, 10);
    if (record.question.length === 0 || record.question.length > 300 || missingFields.length === 0) return undefined;
    return { question: record.question, missingFields };
  } catch {
    return undefined;
  }
}

function parseClarification(value: unknown): { question: string; missingFields: string[] } {
  if (value === null || typeof value !== 'object' || (value as Record<string, unknown>).type !== 'clarification') {
    throw new DomainError('INVALID_ARGUMENT', 'El asistente no devolvió una aclaración válida.');
  }
  const record = value as Record<string, unknown>;
  const question = readString(record.question, 'agent.question', { max: 300 });
  const fields = record.missingFields;
  if (!Array.isArray(fields) || fields.length === 0 || fields.length > 10
    || !fields.every((field) => typeof field === 'string' && field.length <= 64)) {
    throw new DomainError('INVALID_ARGUMENT', 'El asistente no indicó qué dato falta.');
  }
  return { question, missingFields: fields as string[] };
}

function parseDraft(
  value: unknown,
  groupId: string,
  db: Db,
  nowEpochMs: number,
): AgentDraft {
  if (value === null || typeof value !== 'object' || (value as Record<string, unknown>).type !== 'draft') {
    throw new DomainError('INVALID_ARGUMENT', 'El asistente no devolvió un borrador válido.');
  }
  const record = value as Record<string, unknown>;
  const reason = readString(record.reason, 'agent.reason', { max: 200 });

  // Reutiliza la validación runtime del contrato createAlarmRequest.
  const parsed = parseCreateAlarmRequest(
    {
      schemaVersion: 1,
      operationId: 'op-agent-validation',
      groupId,
      payload: {
        title: record.title,
        recipientUids: record.recipientUids,
        mode: record.mode,
        timeSpec: record.timeSpec,
        ...(record.taskId !== undefined ? { taskId: record.taskId } : {}),
      },
    },
    { nowEpochMs },
  );

  for (const uid of parsed.payload.recipientUids) {
    const member = db
      .prepare("SELECT 1 AS ok FROM memberships WHERE group_id = ? AND user_id = ? AND status = 'ACTIVE'")
      .get(groupId, uid);
    if (!member) {
      throw new DomainError('INVALID_ARGUMENT', 'El borrador incluye a alguien que no pertenece al piso.');
    }
  }

  if (parsed.payload.taskId !== undefined && !db.prepare("SELECT 1 FROM tasks WHERE id=? AND group_id=? AND status='PENDING'").get(parsed.payload.taskId, groupId)) {
    throw new DomainError('INVALID_ARGUMENT', 'La tarea debe existir, estar pendiente y pertenecer al piso.');
  }

  const timeSpec: TimeSpec = parsed.payload.timeSpec;
  return {
    type: 'draft',
    title: parsed.payload.title,
    recipientUids: parsed.payload.recipientUids,
    timeSpec,
    mode: parsed.payload.mode,
    ...(parsed.payload.taskId !== undefined ? { taskId: parsed.payload.taskId } : {}),
    reason,
  };
}

export async function proposeAlarm(
  db: Db,
  actor: AuthUser,
  rawInput: unknown,
  config: AgentConfig,
  providerOverride?: AgentProvider,
  nowEpochMs = Date.now(),
): Promise<AgentProposal> {
  const input = readInput(rawInput);
  requireActiveMembership(db, input.groupId, actor.uid);

  const provider = providerOverride ?? createAgentProvider(config);
  if (!provider) {
    throw new DomainError(
      'TEMPORARY_UNAVAILABLE',
      'El asistente no está configurado. Puedes crear la propuesta con el formulario manual.',
    );
  }

  let session: SessionRow | undefined;
  if (input.sessionId) {
    session = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(input.sessionId) as SessionRow | undefined;
    if (!session || session.owner_uid !== actor.uid || session.group_id !== input.groupId
      || session.status !== 'OPEN' || session.expires_at_epoch_ms <= nowEpochMs) {
      throw new DomainError('NOT_FOUND', 'Conversación no encontrada o caducada.');
    }
  } else {
    const sessionId = generateId('ags');
    db.prepare(
      `INSERT INTO agent_sessions
        (id, owner_uid, group_id, status, collected_json, expires_at_epoch_ms, created_at_epoch_ms, updated_at_epoch_ms)
       VALUES (?, ?, ?, 'OPEN', ?, ?, ?, ?)`,
    ).run(
      sessionId,
      actor.uid,
      input.groupId,
      JSON.stringify({ conversation: [input.text] }),
      nowEpochMs + config.sessionTtlMs,
      nowEpochMs,
      nowEpochMs,
    );
    session = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(sessionId) as SessionRow;
  }

  if(session.turns>=6)throw new DomainError('RATE_LIMITED','La conversación alcanzó seis turnos. Inicia una nueva.');
  db.prepare('UPDATE agent_sessions SET turns=turns+1 WHERE id=?').run(session.id);
  const conversation = input.sessionId ? [...readConversation(session), input.text].slice(-5) : [input.text];
  if (input.sessionId) {
    db.prepare('UPDATE agent_sessions SET collected_json = ?, updated_at_epoch_ms = ? WHERE id = ?')
      .run(JSON.stringify({ conversation }), nowEpochMs, session.id);
  }

  const group = db.prepare('SELECT time_zone FROM groups WHERE id = ?').get(input.groupId) as { time_zone: string };
  const tasks = db
    .prepare(
      `SELECT id, title, assigned_to, status, due_at_epoch_ms FROM tasks
       WHERE group_id = ? ORDER BY CASE WHEN status='PENDING' THEN 0 ELSE 1 END,updated_at_epoch_ms DESC,id LIMIT 21`,
    )
    .all(input.groupId) as Array<{
      id: string;
      title: string;
      assigned_to: string | null;
      status: string;
      due_at_epoch_ms: number | null;
    }>;

  const members = listMembers(db, actor.uid, input.groupId);
  const memberName = (uid: string) => members.find(member => member.uid === uid)?.displayName ?? 'Antiguo miembro';
  // Same visibility as the alarm endpoints; an owner's role does not grant access
  // to private requests exchanged only between other household members.
  const alarmRows = db.prepare(`SELECT ar.id FROM alarm_requests ar WHERE ar.group_id=?
    AND (ar.creator_uid=? OR EXISTS(SELECT 1 FROM alarm_recipients r WHERE r.request_id=ar.id AND r.uid=?))
    ORDER BY ar.updated_at_epoch_ms DESC,ar.id LIMIT 21`).all(input.groupId, actor.uid, actor.uid) as Array<{ id: string }>;
  const alarms = alarmRows.slice(0, 20).map(({ id }) => {
    const detail = readAlarmRequest(db, actor.uid, input.groupId, id);
    const recipients = detail.recipients ?? (detail.recipient ? [detail.recipient] : []);
    return { id, request: detail.request, creatorName: memberName(detail.request.creatorUid),
      recipients: recipients.map(recipient => ({ ...recipient, displayName: memberName(recipient.uid) })) };
  });
  const context: AgentContext = {
    actorUid: actor.uid,
    groupId: input.groupId,
    timeZone: group.time_zone,
    nowEpochMs,
    currentLocal: { ...wallClockInZone(nowEpochMs, group.time_zone), timeZone: group.time_zone,
      weekday: new Intl.DateTimeFormat('es-ES', { timeZone: group.time_zone, weekday: 'long' }).format(nowEpochMs) },
    members,
    alarms,
    contextLimits: { tasks: 20, alarms: 20, tasksTruncated: tasks.length > 20, alarmsTruncated: alarmRows.length > 20, alarmVisibility: 'SENT_OR_RECEIVED' },
    tasks: tasks.slice(0, 20).map((task) => ({
      id: task.id,
      title: task.title,
      assignedTo: task.assigned_to,
      status: task.status,
      dueAtEpochMs: task.due_at_epoch_ms,
    })),
    conversation,
  };

  const lastClarification = readLastClarification(session);
  if (lastClarification) context.lastClarification = lastClarification;

  let feedback: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw: unknown;
    try {
      raw = await provider.next(context, feedback);
    } catch (error) {
      if (error instanceof AgentProviderError) {
        throw new DomainError(
          'TEMPORARY_UNAVAILABLE',
          'El asistente no está disponible ahora. Usa el formulario manual.',
        );
      }
      throw error;
    }

    // Model calls yield to other requests: logout/expiry must take effect before
    // storing or returning generated content, on both public agent endpoints.
    const completedAtEpochMs = Date.now();
    const activeSession = db.prepare(
      'SELECT 1 FROM sessions WHERE id=? AND user_id=? AND revoked_at_epoch_ms IS NULL AND expires_at_epoch_ms>?',
    ).get(actor.sessionId, actor.uid, completedAtEpochMs);
    if (!activeSession) throw new DomainError('UNAUTHENTICATED', 'Sesión no válida o caducada.');
    requireActiveMembership(db,input.groupId,actor.uid);
    const type = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>).type : undefined;
    try {
      if (type === 'clarification') {
        const clarification = parseClarification(raw);
        db.prepare('UPDATE agent_sessions SET collected_json = ?, updated_at_epoch_ms = ? WHERE id = ?')
          .run(JSON.stringify({ conversation, lastClarification: clarification }), nowEpochMs, session.id);
        return {
          sessionId: session.id,
          provider: provider.label,
          status: 'needs_clarification',
          ...clarification,
        };
      }
      if (type === 'draft') {
        const draft = parseDraft(raw, input.groupId, db, completedAtEpochMs);
        db.prepare("UPDATE agent_sessions SET status = 'COMPLETED', collected_json = ?, updated_at_epoch_ms = ? WHERE id = ?")
          .run(JSON.stringify({ conversation, draft }), nowEpochMs, session.id);
        return {
          sessionId: session.id,
          provider: provider.label,
          status: 'draft',
          draft,
          requiresSenderReview: true,
          requiresRecipientConsent: true,
          note: 'Revisa y confirma el borrador. Cada destinatario acepta su aviso por separado, también cuando es para ti.',
        };
      }
      feedback = 'La salida debe ser un objeto JSON con type clarification o draft.';
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      feedback = error.message;
    }
  }

  throw new DomainError('TEMPORARY_UNAVAILABLE', 'El asistente devolvió una salida no válida. Usa el formulario manual.');
}
