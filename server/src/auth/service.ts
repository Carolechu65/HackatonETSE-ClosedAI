import { DomainError } from '../../../src/domain/errors.ts';
import type { ServerConfig } from '../config.ts';
import { createOpaqueToken, entityId, sha256Hex } from '../lib/crypto.ts';
import type { Db } from '../persistence/db.ts';
import { hashPassword, verifyPassword } from './password.ts';

export type PublicUser = {
  uid: string;
  email: string;
  displayName: string;
  primaryDeviceId: string | null;
  deviceEpoch: number;
};

export type AuthUser = PublicUser & {
  sessionId: string;
  sessionExpiresAtEpochMs: number;
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  primary_device_id: string | null;
  device_epoch: number;
};

function toPublicUser(row: UserRow): PublicUser {
  return {
    uid: row.id,
    email: row.email,
    displayName: row.display_name,
    primaryDeviceId: row.primary_device_id,
    deviceEpoch: row.device_epoch,
  };
}

export type SessionResponse = {
  token: string;
  expiresAtEpochMs: number;
  user: PublicUser;
};

function createSessionRow(
  db: Db,
  userId: string,
  config: ServerConfig,
  nowEpochMs: number,
): { token: string; expiresAtEpochMs: number } {
  const token = createOpaqueToken();
  const expiresAtEpochMs = nowEpochMs + config.sessionTtlMs;
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at_epoch_ms, expires_at_epoch_ms, last_used_at_epoch_ms)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sha256Hex(token), userId, nowEpochMs, expiresAtEpochMs, nowEpochMs);
  return { token, expiresAtEpochMs };
}

export async function registerUser(
  db: Db,
  config: ServerConfig,
  input: { email: string; password: string; displayName: string },
  nowEpochMs = Date.now(),
): Promise<SessionResponse> {
  const existing = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(input.email);
  if (existing) {
    throw new DomainError('INVALID_ARGUMENT', 'Ese correo ya tiene una cuenta.');
  }
  const passwordHash = await hashPassword(input.password, config);
  const userId = entityId('usr');

  const result = db.transaction(() => {
    db.prepare(
      `INSERT INTO users
        (id, email, password_hash, display_name, primary_device_id, device_epoch, created_at_epoch_ms, updated_at_epoch_ms)
       VALUES (?, ?, ?, ?, NULL, 0, ?, ?)`,
    ).run(userId, input.email, passwordHash, input.displayName, nowEpochMs, nowEpochMs);
    return createSessionRow(db, userId, config, nowEpochMs);
  })();

  return {
    token: result.token,
    expiresAtEpochMs: result.expiresAtEpochMs,
    user: {
      uid: userId,
      email: input.email,
      displayName: input.displayName,
      primaryDeviceId: null,
      deviceEpoch: 0,
    },
  };
}

export async function loginUser(
  db: Db,
  config: ServerConfig,
  input: { email: string; password: string },
  nowEpochMs = Date.now(),
): Promise<SessionResponse> {
  const row = db
    .prepare(
      `SELECT id, email, password_hash, display_name, primary_device_id, device_epoch
       FROM users WHERE email = ? COLLATE NOCASE`,
    )
    .get(input.email) as UserRow | undefined;

  const valid = row ? await verifyPassword(row.password_hash, input.password) : false;
  if (!row || !valid) {
    throw new DomainError('UNAUTHENTICATED', 'Correo o contraseña incorrectos.');
  }

  const session = createSessionRow(db, row.id, config, nowEpochMs);
  return {
    token: session.token,
    expiresAtEpochMs: session.expiresAtEpochMs,
    user: toPublicUser(row),
  };
}

export function authenticate(db: Db, authorizationHeader: string | string[] | undefined, nowEpochMs = Date.now()): AuthUser {
  const header = Array.isArray(authorizationHeader) ? authorizationHeader[0] : authorizationHeader;
  if (!header || !header.startsWith('Bearer ')) {
    throw new DomainError('UNAUTHENTICATED', 'Inicia sesión para continuar.');
  }
  const token = header.slice('Bearer '.length).trim();
  if (token.length < 32 || token.length > 512) {
    throw new DomainError('UNAUTHENTICATED', 'Sesión no válida o caducada.');
  }
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at_epoch_ms, s.revoked_at_epoch_ms, s.last_used_at_epoch_ms,
              u.id, u.email, u.password_hash, u.display_name, u.primary_device_id, u.device_epoch
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .get(sha256Hex(token)) as (UserRow & {
      session_id: string;
      expires_at_epoch_ms: number;
      revoked_at_epoch_ms: number | null;
      last_used_at_epoch_ms: number;
    }) | undefined;

  if (!row || row.revoked_at_epoch_ms !== null || row.expires_at_epoch_ms <= nowEpochMs) {
    throw new DomainError('UNAUTHENTICATED', 'Sesión no válida o caducada.');
  }

  if (nowEpochMs - row.last_used_at_epoch_ms > 5 * 60 * 1000) {
    db.prepare('UPDATE sessions SET last_used_at_epoch_ms = ? WHERE id = ?').run(nowEpochMs, row.session_id);
  }

  return {
    ...toPublicUser(row),
    sessionId: row.session_id,
    sessionExpiresAtEpochMs: row.expires_at_epoch_ms,
  };
}

export function revokeSession(db: Db, sessionId: string, nowEpochMs = Date.now()): void {
  db.prepare('UPDATE sessions SET revoked_at_epoch_ms = ? WHERE id = ? AND revoked_at_epoch_ms IS NULL')
    .run(nowEpochMs, sessionId);
}

export function sessionInfo(user: AuthUser): { expiresAtEpochMs: number } {
  return { expiresAtEpochMs: user.sessionExpiresAtEpochMs };
}

export function publicProfile(user: AuthUser): PublicUser {
  const { sessionId: _sessionId, sessionExpiresAtEpochMs: _expires, ...profile } = user;
  return profile;
}
