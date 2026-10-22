import { DomainError } from '../../../src/domain/errors.ts';
import { CONTRACT_LIMITS } from '../../../src/domain/contracts/types.ts';

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const IDENTIFIER_PATTERN = /^[A-Za-z0-9_:.-]+$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function asRecord(value: unknown, path = '$'): Record<string, unknown> {
  if (!isRecord(value)) throw new DomainError('INVALID_ARGUMENT', `${path}: se esperaba un objeto.`);
  return value;
}

export function assertNoExtraKeys(value: Record<string, unknown>, allowed: readonly string[], path = '$'): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw new DomainError('INVALID_ARGUMENT', `${path}: campos no permitidos.`, { extra });
  }
}

export function readString(value: unknown, path: string, options: { min?: number; max: number }): string {
  if (typeof value !== 'string') throw new DomainError('INVALID_ARGUMENT', `${path}: se esperaba texto.`);
  const trimmed = value.trim();
  if (trimmed.length < (options.min ?? 1)) {
    throw new DomainError('INVALID_ARGUMENT', `${path}: texto vacío o demasiado corto.`);
  }
  if (value.length > options.max) {
    throw new DomainError('INVALID_ARGUMENT', `${path}: máximo ${options.max} caracteres.`);
  }
  return trimmed;
}

export function readIdentifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > CONTRACT_LIMITS.identifierLength
    || !IDENTIFIER_PATTERN.test(value)) {
    throw new DomainError('INVALID_ARGUMENT', `${path}: identificador no válido.`);
  }
  return value;
}

export function readPositiveInt(value: unknown, path: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new DomainError('INVALID_ARGUMENT', `${path}: entero >= ${minimum}.`);
  }
  return value as number;
}

export function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new DomainError('INVALID_ARGUMENT', `${path}: se esperaba booleano.`);
  return value;
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw new DomainError('INVALID_ARGUMENT', 'email: se esperaba texto.');
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new DomainError('INVALID_ARGUMENT', 'email: dirección no válida.');
  }
  return email;
}

export function readPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 10 || value.length > 200) {
    throw new DomainError('INVALID_ARGUMENT', 'password: entre 10 y 200 caracteres.');
  }
  return value;
}

/** Envuelve JSON.parse sin filtrar el contenido del error. */
export function readJsonObject<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
