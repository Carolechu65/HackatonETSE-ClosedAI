import { DomainError, type AppErrorCode } from '../../domain/errors.ts';
import { parseAppError } from '../../domain/contracts/validate.ts';
import { SessionManager, type SessionGuard, type SessionLease } from './session.ts';

export type FetchPort = (url: string, init: RequestInit) => Promise<Response>;
export type HttpClientOptions = {
  baseUrl: string;
  sessions: SessionManager;
  fetch?: FetchPort;
  timeoutMs?: number;
  maxResponseBytes?: number;
  nowEpochMs?: () => number;
};
const messages: Record<AppErrorCode, string> = {
  UNAUTHENTICATED: 'Inicia sesión para continuar.', FORBIDDEN: 'No tienes acceso a esta operación.',
  NOT_FOUND: 'El recurso ya no está disponible.', INVALID_ARGUMENT: 'La petición o respuesta no cumple el contrato.',
  VERSION_CONFLICT: 'La versión ha cambiado; revisa el estado actualizado.', EXPIRED: 'El aviso ha caducado.',
  DEVICE_NOT_PRIMARY: 'Este dispositivo no es el principal.', RATE_LIMITED: 'Demasiadas peticiones; vuelve a intentarlo más tarde.',
  TEMPORARY_UNAVAILABLE: 'El servicio no está disponible temporalmente.',
};
export function remoteError(code: AppErrorCode): DomainError { return new DomainError(code, messages[code]); }

function errorCode(status: number, body: unknown): AppErrorCode {
  // HTTP authorization takes precedence over an untrusted/malformed response body.
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'TEMPORARY_UNAVAILABLE';
  let code: AppErrorCode | undefined;
  try { code = parseAppError(body).code; } catch { /* Never expose remote text or parser details. */ }
  if (status === 403) return code === 'DEVICE_NOT_PRIMARY' ? code : 'FORBIDDEN';
  if (status === 409) return code === 'EXPIRED' ? code : 'VERSION_CONFLICT';
  if (status === 410) return 'EXPIRED';
  return 'INVALID_ARGUMENT';
}

function retryAfterMs(value: string | null, now: number): number | undefined {
  if (!value || value.length > 128) return undefined;
  const delay = /^\d+$/.test(value) ? Number(value) * 1000
    : /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value) ? Date.parse(value) - now : NaN;
  return Number.isFinite(delay) ? Math.min(3_600_000, Math.max(0, Math.ceil(delay))) : undefined;
}

/** One bounded HTTPS transport. It does not retry or own another mutation queue. */
export class HttpClient {
  private readonly options: HttpClientOptions;
  private readonly origin: string;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  constructor(options: HttpClientOptions) {
    let url: URL;
    try { url = new URL(options.baseUrl); } catch { throw remoteError('INVALID_ARGUMENT'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^\/?$/.test(url.pathname)) {
      throw remoteError('INVALID_ARGUMENT');
    }
    this.origin = url.origin;
    this.options = options;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxBytes = options.maxResponseBytes ?? 1_048_576;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000
      || !Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1 || this.maxBytes > 4_194_304) throw remoteError('INVALID_ARGUMENT');
  }

  authenticatedJson(path: string, method: 'GET' | 'POST', body?: unknown, lease = this.options.sessions.lease()): Promise<unknown> {
    return this.request(path, method, body, lease, lease);
  }

  anonymousJson(path: string, method: 'GET' | 'POST', body: unknown, guard: SessionGuard): Promise<unknown> {
    return this.request(path, method, body, guard);
  }

  private async request(path: string, method: 'GET' | 'POST', body: unknown, guard: SessionGuard, lease?: SessionLease): Promise<unknown> {
    guard.assertCurrent();
    if (!/^\/v1\/[A-Za-z0-9/_.-]+(?:\?[^#\s]*)?$/.test(path) || path.includes('\\') || new URL(path, this.origin).origin !== this.origin) {
      throw remoteError('INVALID_ARGUMENT');
    }
    let encoded: string | undefined;
    try { encoded = body === undefined ? undefined : JSON.stringify(body); } catch { throw remoteError('INVALID_ARGUMENT'); }
    if (encoded && new TextEncoder().encode(encoded).byteLength > this.maxBytes) throw remoteError('INVALID_ARGUMENT');
    const controller = new AbortController();
    let rejectCancellation: (error: DomainError) => void = () => undefined;
    const cancelled = new Promise<never>((_, reject) => { rejectCancellation = reject; });
    const onAbort = () => { controller.abort(); rejectCancellation(remoteError('UNAUTHENTICATED')); };
    guard.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => { controller.abort(); rejectCancellation(remoteError('TEMPORARY_UNAVAILABLE')); }, this.timeoutMs);
    const run = async (): Promise<unknown> => {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (encoded !== undefined) headers['Content-Type'] = 'application/json';
      if (lease) headers.Authorization = `Bearer ${lease.token}`;
      const request: RequestInit & { cache: 'no-store' } = {
        method, headers, body: encoded, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
      };
      const response = await (this.options.fetch ?? globalThis.fetch)(`${this.origin}${path}`, request);
      if (controller.signal.aborted) throw remoteError('TEMPORARY_UNAVAILABLE');
      guard.assertCurrent();
      if (response.redirected || (response.status >= 300 && response.status < 400)) throw remoteError('INVALID_ARGUMENT');
      // Invalidate on status even if the body is oversized, malformed, or never finishes.
      if (response.status === 401) {
        if (lease) void this.options.sessions.invalidate(lease).catch(() => undefined);
        throw remoteError('UNAUTHENTICATED');
      }
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > this.maxBytes)) {
        void response.body?.cancel().catch(() => undefined);
        throw remoteError('INVALID_ARGUMENT');
      }
      let raw = '';
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let size = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (controller.signal.aborted) throw remoteError('TEMPORARY_UNAVAILABLE');
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > this.maxBytes) throw remoteError('INVALID_ARGUMENT');
            raw += decoder.decode(chunk.value, { stream: true });
          }
          raw += decoder.decode();
        } finally { void reader.cancel().catch(() => undefined); }
      } else {
        // React Native versions without fetch streams still get a post-read bound.
        raw = await response.text();
        if (new TextEncoder().encode(raw).byteLength > this.maxBytes) throw remoteError('INVALID_ARGUMENT');
      }
      if (controller.signal.aborted) throw remoteError('TEMPORARY_UNAVAILABLE');
      guard.assertCurrent();
      let value: unknown;
      try { value = raw === '' && response.status === 204 ? null : JSON.parse(raw); }
      catch { if (response.ok) throw remoteError('INVALID_ARGUMENT'); }
      if (!response.ok) {
        const code = errorCode(response.status, value);
        const retryAfter = response.status === 429 || response.status === 503
          ? retryAfterMs(response.headers.get('retry-after'), (this.options.nowEpochMs ?? Date.now)()) : undefined;
        throw new DomainError(code, messages[code], retryAfter === undefined ? undefined : { retryAfterMs: retryAfter });
      }
      return value;
    };
    try {
      if (guard.signal.aborted) onAbort();
      return await Promise.race([run(), cancelled]);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw remoteError('TEMPORARY_UNAVAILABLE');
    } finally {
      clearTimeout(timer); guard.signal.removeEventListener('abort', onAbort); controller.abort();
    }
  }
}
