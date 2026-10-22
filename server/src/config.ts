import { calendarConfig, type CalendarConfig } from './calendar/config.ts';
/**
 * Configuración del servidor. No hay secretos por defecto: las variables
 * privadas se leen del entorno del proceso y nunca se registran.
 */
export type ServerConfig = {
  calendar: CalendarConfig | null;
  host: string;
  port: number;
  databasePath: string;
  sessionTtlMs: number;
  trustProxy: boolean;
  corsOrigins: string[];
  logLevel: string;
  bodyLimitBytes: number;
  authRateLimit: { max: number; windowMs: number };
  operationRateLimit: { max: number; windowMs: number };
  agentRateLimit: { max: number; windowMs: number };
  argon2: { memoryCost: number; timeCost: number; parallelism: number };
  push: { expoToken: string | null; workerEnabled: boolean; pollIntervalMs: number; leaseMs: number };
  agent: {
    provider: 'none' | 'deterministic' | 'openai';
    baseUrl: string | null;
    apiKey: string | null;
    model: string | null;
    timeoutMs: number;
    sessionTtlMs: number;
  };
};

function intFromEnv(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} debe ser un entero positivo.`);
  }
  return parsed;
}

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const provider = (env.AI_PROVIDER ?? (env.OPENROUTER_API_KEY ? 'openai' : 'none')).trim();
  if (provider !== 'none' && provider !== 'deterministic' && provider !== 'openai') {
    throw new Error('AI_PROVIDER debe ser none, deterministic u openai.');
  }
  return {
    calendar: calendarConfig(env),
    host: env.HOST?.trim() || '127.0.0.1',
    port: intFromEnv(env.PORT, 8787, 'PORT'),
    databasePath: env.DATABASE_PATH?.trim() || './data/alarmat.db',
    sessionTtlMs: intFromEnv(env.SESSION_TTL_MS, 7 * 24 * 60 * 60 * 1000, 'SESSION_TTL_MS'),
    trustProxy: boolFromEnv(env.TRUST_PROXY, false),
    corsOrigins:(env.CORS_ORIGINS??'').split(',').map(v=>v.trim()).filter(Boolean),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    bodyLimitBytes: intFromEnv(env.BODY_LIMIT_BYTES, 64 * 1024, 'BODY_LIMIT_BYTES'),
    authRateLimit: {
      max: intFromEnv(env.AUTH_RATE_LIMIT, 20, 'AUTH_RATE_LIMIT'),
      windowMs: intFromEnv(env.AUTH_RATE_WINDOW_MS, 60_000, 'AUTH_RATE_WINDOW_MS'),
    },
    operationRateLimit: {
      max: intFromEnv(env.OPERATION_RATE_LIMIT, 120, 'OPERATION_RATE_LIMIT'),
      windowMs: intFromEnv(env.OPERATION_RATE_WINDOW_MS, 60_000, 'OPERATION_RATE_WINDOW_MS'),
    },
    agentRateLimit: {
      max: intFromEnv(env.AGENT_RATE_LIMIT, 10, 'AGENT_RATE_LIMIT'),
      windowMs: intFromEnv(env.AGENT_RATE_WINDOW_MS, 60_000, 'AGENT_RATE_WINDOW_MS'),
    },
    // Parámetros OWASP mínimos para Argon2id. En pruebas se reducen.
    argon2: {
      memoryCost: intFromEnv(env.ARGON2_MEMORY_KIB, 19_456, 'ARGON2_MEMORY_KIB'),
      timeCost: intFromEnv(env.ARGON2_TIME_COST, 2, 'ARGON2_TIME_COST'),
      parallelism: intFromEnv(env.ARGON2_PARALLELISM, 1, 'ARGON2_PARALLELISM'),
    },
    push: {
      expoToken: env.EXPO_PUSH_TOKEN?.trim() || null,
      workerEnabled: boolFromEnv(env.PUSH_WORKER_ENABLED, false),
      pollIntervalMs: intFromEnv(env.PUSH_POLL_MS, 2_000, 'PUSH_POLL_MS'),
      leaseMs: intFromEnv(env.PUSH_LEASE_MS, 30_000, 'PUSH_LEASE_MS'),
    },
    agent: {
      provider,
      baseUrl: env.AI_BASE_URL?.trim().replace(/\/+$/, '') || (env.OPENROUTER_API_KEY?'https://openrouter.ai/api/v1':null),
      apiKey: env.AI_API_KEY?.trim() || env.OPENROUTER_API_KEY?.trim() || null,
      model: env.AI_MODEL?.trim() || env.OPENROUTER_MODEL?.trim() || (env.OPENROUTER_API_KEY?'deepseek/deepseek-v4.1-flash':null),
      timeoutMs: intFromEnv(env.AI_TIMEOUT_MS, 15_000, 'AI_TIMEOUT_MS'),
      sessionTtlMs: intFromEnv(env.AGENT_SESSION_TTL_MS, 30 * 60 * 1000, 'AGENT_SESSION_TTL_MS'),
    },
  };
}
