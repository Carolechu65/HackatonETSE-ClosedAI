/**
 * Identidad estable de ocurrencias e identificadores de operación.
 *
 * La identidad incorpora usuario, propuesta, ocurrencia y dispositivo: reintentar
 * una aceptación, un push o una sincronización no puede añadir otra programación.
 * Misma forma que `OccurrenceKey` en `src/platform/alarms/index.ts` (frontera P4).
 */
import { DomainError } from './errors.ts';

export type OccurrenceIdentity = {
  userId: string;
  requestId: string;
  occurrenceId: string;
  deviceId: string;
  deviceEpoch: number;
};

export const OCCURRENCE_ID_PREFIX = 'occ-';

/** `occ-<epochMs>`: determinista, así que un reintento reutiliza la misma ocurrencia. */
export function occurrenceIdFromEpochMs(epochMs: number): string {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new DomainError('INVALID_ARGUMENT', 'Instante inválido para una ocurrencia.', { epochMs });
  }
  return `${OCCURRENCE_ID_PREFIX}${epochMs}`;
}

/** Clave de almacenamiento local/nativo. Nunca se usa como identificador visible. */
export function occurrenceKey(identity: OccurrenceIdentity): string {
  const { userId, requestId, occurrenceId, deviceId, deviceEpoch } = identity;
  if (!userId || !requestId || !occurrenceId || !deviceId) {
    throw new DomainError('INVALID_ARGUMENT', 'Identidad de ocurrencia incompleta.');
  }
  return `${userId}|${requestId}|${occurrenceId}|${deviceId}@${deviceEpoch}`;
}

export interface IdGenerator {
  next(prefix?: string): string;
}

/**
 * Identificadores únicos para `operationId` y entidades locales.
 * No son secretos: la autorización depende de Auth y de las reglas, nunca del ID.
 */
export function createIdGenerator(options: { now?: () => number; random?: () => number } = {}): IdGenerator {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  return {
    next(prefix = 'op') {
      const time = now().toString(36);
      const noise = Math.floor(random() * 1_000_000_000).toString(36).padStart(6, '0');
      return `${prefix}-${time}-${noise}`;
    },
  };
}

/** Generador determinista para tests y fakes: `id-1`, `id-2`, … */
export function createDeterministicIdGenerator(prefix = 'id'): IdGenerator {
  let counter = 0;
  return {
    next(customPrefix = prefix) {
      counter += 1;
      return `${customPrefix}-${counter}`;
    },
  };
}
