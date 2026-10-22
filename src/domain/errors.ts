/**
 * Errores tipados del dominio (contrato `appErrorCode`).
 *
 * Un `catch` genérico nunca equivale a éxito: la UI debe representar el estado
 * pendiente y solo reintentar los códigos transitorios.
 */

export const APP_ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INVALID_ARGUMENT',
  'VERSION_CONFLICT',
  'EXPIRED',
  'DEVICE_NOT_PRIMARY',
  'RATE_LIMITED',
  'TEMPORARY_UNAVAILABLE',
] as const;
export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export class DomainError extends Error {
  readonly code: AppErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: AppErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && (APP_ERROR_CODES as readonly string[]).includes(value);
}

const RETRYABLE_CODES: readonly AppErrorCode[] = ['RATE_LIMITED', 'TEMPORARY_UNAVAILABLE'];

/** Solo fallos transitorios se reintentan con backoff y jitter. */
export function isRetryableError(code: AppErrorCode): boolean {
  return RETRYABLE_CODES.includes(code);
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/** Convierte cualquier excepción en un error de dominio sin filtrar detalles privados. */
export function toDomainError(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  if (error instanceof Error) {
    return new DomainError('TEMPORARY_UNAVAILABLE', error.message);
  }
  return new DomainError('TEMPORARY_UNAVAILABLE', 'Error inesperado.');
}
