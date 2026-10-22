import type { FastifyError, FastifyInstance } from 'fastify';
import { DomainError, isDomainError, isRetryableError, type AppErrorCode } from '../../../src/domain/errors.ts';

const HTTP_BY_CODE: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_ARGUMENT: 400,
  VERSION_CONFLICT: 409,
  EXPIRED: 409,
  DEVICE_NOT_PRIMARY: 403,
  RATE_LIMITED: 429,
  TEMPORARY_UNAVAILABLE: 503,
};

export function appErrorBody(code: AppErrorCode, message: string, details?: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    code,
    message: message.slice(0, 300),
    retryable: isRetryableError(code),
    serverTimeEpochMs: Date.now(),
  };
  if (details && Object.keys(details).length > 0) body.details = details;
  return body;
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | DomainError, request, reply) => {
    if (isDomainError(error)) {
      const status = HTTP_BY_CODE[error.code];
      if (error.code === 'RATE_LIMITED' && error.details?.retryAfterMs) {
        const seconds = Math.max(1, Math.ceil(Number(error.details.retryAfterMs) / 1000));
        reply.header('retry-after', String(seconds));
      }
      return reply.status(status).send(appErrorBody(error.code, error.message, error.details));
    }

    if (error.statusCode === 400 || error.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || error.code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
      return reply.status(400).send(appErrorBody('INVALID_ARGUMENT', 'Cuerpo de la petición no válido.'));
    }
    if (error.statusCode === 415) {
      return reply.status(400).send(appErrorBody('INVALID_ARGUMENT', 'Tipo de contenido no soportado.'));
    }
    if (error.statusCode === 413) {
      return reply.status(413).send(appErrorBody('INVALID_ARGUMENT', 'Cuerpo de la petición demasiado grande.'));
    }
    request.log.error({
      err: error,
      method: request.method,
      url: request.url,
    }, 'request failed');
    return reply.status(500).send(appErrorBody('TEMPORARY_UNAVAILABLE', 'Fallo temporal del servidor.'));
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send(appErrorBody('NOT_FOUND', 'Ruta no encontrada.'));
  });
}
