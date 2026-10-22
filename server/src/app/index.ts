import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { DomainError, isRetryableError } from "../../../src/domain/errors.ts";
import {
  OPERATION_PARSERS,
  type OperationName,
} from "../../../src/domain/contracts/validate.ts";
import type { Db } from "../persistence/database.ts";
import { authenticate, authRoutes } from "../auth/routes.ts";
import { householdRoutes } from "../operations/household.ts";
import { execute } from "../operations/alarms.ts";
import { sync } from "../messaging/feed.ts";
import { draftAlarm, type AgentConfig } from "../agents/draft.ts";
export type AppOptions = {
  db: Db;
  now?: () => number;
  sessionDurationMs?: number;
  corsOrigins?: string[];
  agent?: AgentConfig;
  logger?: boolean;
};
export async function buildApp(options: AppOptions) {
  const db = options.db,
    now = options.now ?? Date.now;
  const duration = options.sessionDurationMs ?? 7 * 86400000;
  if (
    !Number.isSafeInteger(duration) ||
    duration < 1000 ||
    duration > 90 * 86400000
  )
    throw new Error("SESSION_DURATION_MS must be between 1000 and 7776000000");
  const app = Fastify({
    bodyLimit: 16384,
    logger: options.logger
      ? {
          redact: [
            "req.headers.authorization",
            "req.body",
            "res.headers.set-cookie",
          ],
          serializers: {
            req: (r) => ({
              method: r.method,
              url: r.url?.split("?")[0],
              remoteAddress: r.ip,
            }),
          },
        }
      : false,
  });
  await app.register(cors, {
    origin: options.corsOrigins ?? [],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  await app.register(rateLimit, {
    max: 180,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({
      code: "RATE_LIMITED",
      message: "Demasiadas peticiones.",
      retryable: true,
      serverTimeEpochMs: now(),
    }),
  });
  app.setErrorHandler((error, req, reply) => {
    const typed = error as Error & { statusCode?: number; code?: string };
    if (error instanceof DomainError) {
      const statuses = {
        UNAUTHENTICATED: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        INVALID_ARGUMENT: 400,
        VERSION_CONFLICT: 409,
        EXPIRED: 410,
        DEVICE_NOT_PRIMARY: 409,
        RATE_LIMITED: 429,
        TEMPORARY_UNAVAILABLE: 503,
      };
      return reply.code(statuses[error.code]).send({
        code: error.code,
        message: error.message,
        retryable: isRetryableError(error.code),
        serverTimeEpochMs: now(),
        ...(error.details ? { details: error.details } : {}),
      });
    }
    if (typed.statusCode === 429)
      return reply.code(429).send({
        code: "RATE_LIMITED",
        message: "Demasiadas peticiones.",
        retryable: true,
        serverTimeEpochMs: now(),
      });
    if (typed.statusCode === 400 || typed.statusCode === 413)
      return reply.code(400).send({
        code: "INVALID_ARGUMENT",
        message: "Entrada no válida.",
        retryable: false,
        serverTimeEpochMs: now(),
      });
    req.log.error({ code: typed.code ?? "INTERNAL" }, "request_failed");
    return reply.code(503).send({
      code: "TEMPORARY_UNAVAILABLE",
      message: "No se pudo completar la operación.",
      retryable: true,
      serverTimeEpochMs: now(),
    });
  });
  const actor = (r: Parameters<typeof authenticate>[1]) =>
    authenticate(db, r, now());
  app.get("/health", async () => ({ status: "ok" }));
  authRoutes(app, db, now, duration);
  householdRoutes(app, db, actor, now);
  app.post("/v1/operations/:kind", async (r) => {
    const user = actor(r),
      { kind } = r.params as { kind: string };
    if (!Object.hasOwn(OPERATION_PARSERS, kind))
      throw new DomainError("NOT_FOUND", "Operación desconocida.");
    return execute(db, user, kind as OperationName, r.body, now());
  });
  app.get("/v1/sync", async (r) =>
    sync(db, actor(r), (r.query as { cursor?: unknown }).cursor, now()),
  );
  app.post(
    "/v1/agent/draft",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (r) => {
      const user = actor(r),
        result = await draftAlarm(db, user, r.body, now(), options.agent ?? {});
      actor(r);
      return result;
    },
  );
  return app;
}
