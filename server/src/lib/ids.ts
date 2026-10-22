import { entityId } from './crypto.ts';

/** Identificadores de entidad no secretos (UUID con prefijo legible). */
export function generateId(prefix: string): string {
  return entityId(prefix);
}
