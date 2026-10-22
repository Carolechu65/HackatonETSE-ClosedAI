/** Proyección para la UI; no sustituye los estados/versiones del contrato remoto. */
export type AlarmSummary = {
  id: string;
  title: string;
  proposedBy: string;
  scheduledAt: string | null;
  decision: 'pending' | 'accepted' | 'rejected';
  scheduling: 'not_scheduled' | 'pending_activation' | 'scheduled';
};

export type OperationEnvelope<TPayload> = {
  schemaVersion: 1;
  operationId: string;
  groupId: string;
  entityId: string;
  expectedRequestVersion?: number;
  expectedDecisionRevision?: number;
  payload: TPayload;
};

export interface Clock { nowEpochMs(): number }
export const systemClock: Clock = { nowEpochMs: () => Date.now() };
