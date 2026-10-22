/**
 * Transporte HTTP → dominio.
 *
 * La API del VPS devuelve `OperationReceipt` o `AppError`, pero el proxy, la red
 * o un 500 sin JSON no lo hacen. El adaptador (P5) normaliza aquí para no
 * interpretar jamás una respuesta rota como un recibo válido.
 *
 * Mapeo acordado en el TDD (`Transporte HTTP objetivo`).
 */
import { isAppErrorCode, isRetryableError, type AppErrorCode } from './errors.ts';
import type { AppErrorPayload } from './contracts/types.ts';

export type HttpStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

const STATUS_BY_CODE: Readonly<Record<AppErrorCode, HttpStatus>> = {
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

const CODE_BY_STATUS: Readonly<Record<number, AppErrorCode>> = {
  400: 'INVALID_ARGUMENT',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'VERSION_CONFLICT',
  429: 'RATE_LIMITED',
  500: 'TEMPORARY_UNAVAILABLE',
  503: 'TEMPORARY_UNAVAILABLE',
};

const GENERIC_MESSAGE: Readonly<Record<AppErrorCode, string>> = {
  INVALID_ARGUMENT: 'La petición no es válida.',
  UNAUTHENTICATED: 'Tu sesión ya no es válida. Vuelve a iniciar sesión.',
  FORBIDDEN: 'No tienes permiso para esta acción.',
  NOT_FOUND: 'No encontramos ese recurso.',
  VERSION_CONFLICT: 'El estado cambió; vuelve a cargar antes de continuar.',
  EXPIRED: 'Esa propuesta ya no admite cambios.',
  DEVICE_NOT_PRIMARY: 'Este no es tu dispositivo principal.',
  RATE_LIMITED: 'Demasiadas peticiones; espera un momento.',
  TEMPORARY_UNAVAILABLE: 'El servidor no está disponible; inténtalo más tarde.',
};

export function httpStatusForErrorCode(code: AppErrorCode): HttpStatus {
  return STATUS_BY_CODE[code];
}

/**
 * Código por defecto de un estado HTTP. Si el cuerpo trae `code` válido, ese
 * código gana: un 409 puede ser `VERSION_CONFLICT` o `EXPIRED`.
 */
export function defaultErrorCodeForStatus(status: number): AppErrorCode {
  return CODE_BY_STATUS[status] ?? 'TEMPORARY_UNAVAILABLE';
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 503;
}

/** Un 401 pausa la outbox de esa cuenta: reintentar sin sesión solo genera ruido. */
export function pausesOutbox(code: AppErrorCode): boolean {
  return code === 'UNAUTHENTICATED';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Acepta un `AppError` del servidor y sintetiza uno seguro si el cuerpo no sirve. */
export function normalizeHttpError(status: number, body: unknown): AppErrorPayload {
  const fallbackCode = defaultErrorCodeForStatus(status);
  if (isRecord(body) && isAppErrorCode(body.code)) {
    const message = typeof body.message === 'string' && body.message.trim().length > 0
      ? body.message
      : GENERIC_MESSAGE[body.code];
    const error: AppErrorPayload = {
      code: body.code,
      message,
      retryable: typeof body.retryable === 'boolean' ? body.retryable : isRetryableError(body.code),
    };
    if (typeof body.serverTimeEpochMs === 'number' && Number.isSafeInteger(body.serverTimeEpochMs)) {
      error.serverTimeEpochMs = body.serverTimeEpochMs;
    }
    return error;
  }
  return {
    code: fallbackCode,
    message: GENERIC_MESSAGE[fallbackCode],
    retryable: isRetryableHttpStatus(status) || isRetryableError(fallbackCode),
  };
}

/**
 * `Retry-After` puede ser segundos o una fecha HTTP. Devuelve milisegundos
 * acotados a un día para que un valor absurdo no bloquee la outbox.
 */
export function retryAfterMs(headerValue: string | null, nowEpochMs: number): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, 24 * 60 * 60 * 1000);
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(0, date - nowEpochMs), 24 * 60 * 60 * 1000);
}
