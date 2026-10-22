import type { AlarmRequestDocument, RecipientDocument } from '../../../src/domain/contracts/types.ts';

export type AgentMember = { uid: string; displayName: string; role: 'OWNER' | 'MEMBER' };
export type AgentTask = { id: string; title: string; assignedTo: string | null; status: string; dueAtEpochMs: number | null };
export type AgentAlarm = { id: string; request: AlarmRequestDocument; creatorName: string; recipients: Array<RecipientDocument & { displayName: string }> };

export type AgentContext = {
  actorUid: string;
  groupId: string;
  timeZone: string;
  nowEpochMs: number;
  currentLocal: { localDate: string; localTime: string; timeZone: string; weekday: string };
  members: AgentMember[];
  tasks: AgentTask[];
  alarms: AgentAlarm[];
  contextLimits: { tasks: number; alarms: number; tasksTruncated: boolean; alarmsTruncated: boolean; alarmVisibility: 'SENT_OR_RECEIVED' };
  conversation: string[];
  /** Pregunta anterior del asistente, para continuar una aclaración. */
  lastClarification?: { question: string; missingFields: string[] };
};

export type AgentClarification = {
  type: 'clarification';
  question: string;
  missingFields: string[];
};

export type AgentDraft = {
  type: 'draft';
  title: string;
  recipientUids: string[];
  timeSpec: {
    timeZone: string;
    localDate: string;
    localTime: string;
    effectiveAtEpochMs: number;
  };
  mode: 'ALARM' | 'NOTIFICATION';
  taskId?: string;
  reason: string;
};

export type AgentTurn = AgentClarification | AgentDraft;

/** Puerto intercambiable: un modelo real o un adapter determinista de pruebas/demo. */
export interface AgentProvider {
  readonly label: string;
  next(context: AgentContext, feedback?: string): Promise<unknown>;
}

export class AgentProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentProviderError';
  }
}
