import { DomainError } from '../../../src/domain/errors.ts';
import { generateId } from '../lib/ids.ts';
import { readIdentifier } from '../lib/validation.ts';
import type { Db } from '../persistence/db.ts';
import type { AuthUser } from '../auth/service.ts';
import { appendChangeEvent } from '../persistence/events.ts';
import { assertExpoPushToken } from '../messaging/push.ts';

export type DevicePlatform = 'android' | 'ios' | 'web' | 'unknown';

export type DeviceInput = {
  deviceId?: unknown;
  platform?: unknown;
  pushToken?: unknown;
};

type DeviceRow = {
  id: string;
  user_id: string;
  platform: DevicePlatform;
  push_token: string | null;
  status: 'ACTIVE' | 'REVOKED';
  device_epoch?: number;
};

function readPlatform(value: unknown): DevicePlatform {
  if (value === undefined) return 'unknown';
  if (value === 'android' || value === 'ios' || value === 'web' || value === 'unknown') return value;
  throw new DomainError('INVALID_ARGUMENT', 'body.platform: android, ios, web o unknown.');
}

function readPushToken(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length < 8 || value.length > 512) {
    throw new DomainError('INVALID_ARGUMENT', 'body.pushToken: token de push no válido.');
  }
  assertExpoPushToken(value);
  return value;
}

export type RegisteredDevice = {
  deviceId: string;
  deviceEpoch: number;
  primary: boolean;
};

export function registerDevice(
  db: Db,
  actor: AuthUser,
  input: DeviceInput,
  nowEpochMs = Date.now(),
): RegisteredDevice {
  const platform = readPlatform(input.platform);
  const pushToken = readPushToken(input.pushToken);
  const deviceId = input.deviceId === undefined ? generateId('dev') : readIdentifier(input.deviceId, 'body.deviceId');

  const existing = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId) as DeviceRow | undefined;
  if (existing && existing.user_id !== actor.uid) {
    throw new DomainError('FORBIDDEN', 'Ese dispositivo pertenece a otra cuenta.');
  }

  return db.transaction(() => {
    if (existing) {
      db.prepare(
        `UPDATE devices SET platform = ?, push_token = ?, status = 'ACTIVE',
         updated_at_epoch_ms = ?, last_seen_at_epoch_ms = ?
         WHERE id = ?`,
      ).run(platform, pushToken ?? existing.push_token, nowEpochMs, nowEpochMs, deviceId);
    } else {
      db.prepare(
        `INSERT INTO devices
          (id, user_id, platform, push_token, status, created_at_epoch_ms, updated_at_epoch_ms, last_seen_at_epoch_ms)
         VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
      ).run(deviceId, actor.uid, platform, pushToken, nowEpochMs, nowEpochMs, nowEpochMs);
    }

    const user = db.prepare('SELECT primary_device_id, device_epoch FROM users WHERE id = ?').get(actor.uid) as {
      primary_device_id: string | null;
      device_epoch: number;
    };
    let primary = user.primary_device_id === deviceId;
    let deviceEpoch = user.device_epoch;
    if (user.primary_device_id === null) {
      deviceEpoch = Math.max(1, user.device_epoch + 1);
      db.prepare('UPDATE users SET primary_device_id = ?, device_epoch = ?, updated_at_epoch_ms = ? WHERE id = ?')
        .run(deviceId, deviceEpoch, nowEpochMs, actor.uid);
      primary = true;
    }

    appendChangeEvent(db, {
      audienceUid: actor.uid,
      groupId: '',
      entityType: 'device',
      entityId: deviceId,
      entityVersion: deviceEpoch,
      kind: 'UPSERT',
      payload: { deviceId, deviceEpoch, platform },
      nowEpochMs,
    });

    return { deviceId, deviceEpoch, primary };
  })();
}

export function setPrimaryDevice(
  db: Db,
  actor: AuthUser,
  input: { deviceId?: unknown },
  nowEpochMs = Date.now(),
): RegisteredDevice {
  const deviceId = readIdentifier(input.deviceId, 'body.deviceId');
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId) as DeviceRow | undefined;
  if (!device || device.user_id !== actor.uid || device.status !== 'ACTIVE') {
    throw new DomainError('NOT_FOUND', 'Dispositivo no encontrado.');
  }
  return db.transaction(() => {
    const user = db.prepare('SELECT device_epoch,primary_device_id FROM users WHERE id = ?').get(actor.uid) as { device_epoch: number; primary_device_id: string|null };
    if(user.primary_device_id===deviceId)return {deviceId,deviceEpoch:user.device_epoch,primary:true};
    const deviceEpoch = user.device_epoch + 1;
    db.prepare('UPDATE users SET primary_device_id = ?, device_epoch = ?, updated_at_epoch_ms = ? WHERE id = ?')
      .run(deviceId, deviceEpoch, nowEpochMs, actor.uid);
    appendChangeEvent(db, {
      audienceUid: actor.uid,
      groupId: '',
      entityType: 'device',
      entityId: deviceId,
      entityVersion: deviceEpoch,
      kind: 'UPSERT',
      payload: { deviceId, deviceEpoch, primary: true },
      nowEpochMs,
    });
    return { deviceId, deviceEpoch, primary: true };
  })();
}

export function revokePushToken(db: Db, userId: string, deviceId: string): void {
  db.prepare("UPDATE devices SET push_token = NULL, status = 'REVOKED', updated_at_epoch_ms = ? WHERE id = ? AND user_id = ?")
    .run(Date.now(), deviceId, userId);
}
