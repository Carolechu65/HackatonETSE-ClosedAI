import { loadConfig } from './config.ts';
import { buildApp } from './app/buildApp.ts';
import { openDatabase, assertSchemaReady } from './persistence/db.ts';
import { OutboxWorker } from './messaging/outboxWorker.ts';
import { ExpoPushSender } from './messaging/push.ts';
import { createAgentProvider } from './agents/service.ts';

const config = loadConfig();
const db = openDatabase(config.databasePath);
try {
  assertSchemaReady(db);
} catch (error) {
  db.close();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const app = buildApp({ config, db });
const agent = createAgentProvider(config.agent);
if (config.agent.provider === 'openai' && !agent) {
  app.log.warn('AI_PROVIDER=openai sin AI_BASE_URL/AI_API_KEY/AI_MODEL: el agente responderá 503 y queda el formulario manual.');
}

const worker = new OutboxWorker(
  db,
  config.push.workerEnabled && config.push.expoToken ? new ExpoPushSender(config.push.expoToken) : null,
  { pollIntervalMs: config.push.pollIntervalMs, leaseMs: config.push.leaseMs, logger: app.log },
);
if (config.push.workerEnabled && config.push.expoToken) {
  worker.start();
} else {
  app.log.info('Push desactivado o sin EXPO_PUSH_TOKEN: outbox persistida y sincronización al abrir la app.');
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  worker.stop();
  await app.close();
  db.close();
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  worker.stop();
  db.close();
  process.exit(1);
}
