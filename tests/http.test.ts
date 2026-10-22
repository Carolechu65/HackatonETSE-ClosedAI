import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  defaultErrorCodeForStatus,
  httpStatusForErrorCode,
  isRetryableHttpStatus,
  normalizeHttpError,
  pausesOutbox,
  retryAfterMs,
  type AppErrorCode,
} from '../src/domain/index.ts';

test('cada código de la v1 tiene su estado HTTP', () => {
  const expected: Record<AppErrorCode, number> = {
    INVALID_ARGUMENT: 400,
    UNAUTHENTICATED: 401,
    FORBIDDEN: 403,
    DEVICE_NOT_PRIMARY: 403,
    NOT_FOUND: 404,
    VERSION_CONFLICT: 409,
    EXPIRED: 409,
    RATE_LIMITED: 429,
    TEMPORARY_UNAVAILABLE: 503,
  };
  for (const [code, status] of Object.entries(expected) as [AppErrorCode, number][]) {
    assert.equal(httpStatusForErrorCode(code), status, code);
  }
  assert.equal(defaultErrorCodeForStatus(409), 'VERSION_CONFLICT');
  assert.equal(defaultErrorCodeForStatus(401), 'UNAUTHENTICATED');
  assert.equal(defaultErrorCodeForStatus(500), 'TEMPORARY_UNAVAILABLE');
});

test('solo 429, 500 y 503 se reintentan; un 401 pausa la outbox', () => {
  assert.equal(isRetryableHttpStatus(429), true);
  assert.equal(isRetryableHttpStatus(500), true);
  assert.equal(isRetryableHttpStatus(503), true);
  assert.equal(isRetryableHttpStatus(409), false);
  assert.equal(pausesOutbox('UNAUTHENTICATED'), true);
  assert.equal(pausesOutbox('VERSION_CONFLICT'), false);
});

test('un AppError del servidor conserva código y mensaje', () => {
  const error = normalizeHttpError(409, {
    code: 'EXPIRED',
    message: 'La propuesta ya no admite respuestas.',
    retryable: false,
    serverTimeEpochMs: 1792701000000,
  });
  assert.deepEqual(error, {
    code: 'EXPIRED',
    message: 'La propuesta ya no admite respuestas.',
    retryable: false,
    serverTimeEpochMs: 1792701000000,
  });
});

test('un cuerpo roto no se interpreta como recibo: se sintetiza un error seguro', () => {
  const error = normalizeHttpError(503, '<html>Bad Gateway</html>');
  assert.equal(error.code, 'TEMPORARY_UNAVAILABLE');
  assert.equal(error.retryable, true);
  assert.ok(!error.message.includes('html'));

  const conflict = normalizeHttpError(409, { code: 'NO_EXISTE' });
  assert.equal(conflict.code, 'VERSION_CONFLICT');
  assert.equal(conflict.retryable, false);

  const proxy = normalizeHttpError(500, null);
  assert.equal(proxy.code, 'TEMPORARY_UNAVAILABLE');
});

test('Retry-After admite segundos y fecha HTTP, acotado a un día', () => {
  assert.equal(retryAfterMs('30', 0), 30_000);
  assert.equal(retryAfterMs(null, 0), null);
  assert.equal(retryAfterMs('no-es-fecha', 0), null);
  assert.equal(retryAfterMs(String(60 * 60 * 24 * 10), 0), 24 * 60 * 60 * 1000);

  const now = Date.parse('2026-10-22T09:00:00Z');
  assert.equal(retryAfterMs(new Date(now + 5_000).toUTCString(), now), 5_000);
  assert.equal(retryAfterMs(new Date(now - 5_000).toUTCString(), now), 0);
});
