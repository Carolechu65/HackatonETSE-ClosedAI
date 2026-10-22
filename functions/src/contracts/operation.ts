import { HttpsError } from 'firebase-functions/v2/https';

/** Sobre inicial del TDD. P3/P1 deben concretar y compartir cada payload. */
export interface OperationEnvelope {
  schemaVersion: 1;
  operationId: string;
  groupId: string;
  payload: Record<string, unknown>;
}

export function parseOperation(data: unknown): OperationEnvelope {
  if (!isRecord(data) || data.schemaVersion !== 1 ||
      !isIdentifier(data.operationId) || !isIdentifier(data.groupId) ||
      !isRecord(data.payload)) {
    throw new HttpsError('invalid-argument', 'Se requiere schemaVersion=1, operationId, groupId y payload.');
  }
  return {
    schemaVersion: 1,
    operationId: data.operationId,
    groupId: data.groupId,
    payload: data.payload,
  };
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
