import type { HttpWireCodec } from '../data/remote/gateway.ts';
import type { SyncPage } from '../data/model.ts';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Respuesta HTTP inválida.');
  return value as Record<string, unknown>;
}
/** Canonical P3 auth -> P5 normalized ports; no second session or token storage. */
export const productWireCodec: HttpWireCodec = {
  syncPath: '/v1/sync?projection=alarms',
  decodeSession(input) {
    const body = object(input); const user = object(body.user);
    const session = body.session ? object(body.session) : body;
    if (typeof user.uid !== 'string' || typeof session.token !== 'string' || !Number.isSafeInteger(session.expiresAtEpochMs)) throw new Error('Sesión inválida.');
    return { userId: user.uid, token: session.token, expiresAtEpochMs: session.expiresAtEpochMs as number };
  },
  decodeMe(input) {
    const body = object(input); const user = object(body.user);
    if (typeof user.uid !== 'string') throw new Error('Perfil inválido.');
    return { userId: user.uid };
  },
  // P5 validates every field, DTO and scope immediately after this structural boundary.
  decodeSyncPage: input => object(input) as SyncPage,
};
