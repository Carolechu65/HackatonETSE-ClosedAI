import { SessionManager, type SecureStorage } from '../data/remote/session.ts';
import { HttpClient } from '../data/remote/http.ts';
import { HttpAlarmGateway, HttpAuthClient } from '../data/remote/gateway.ts';
import { operationNameOf } from '../domain/contracts/operations.ts';
import { productWireCodec } from './wire.ts';
import { apiBaseUrlFromEnv } from '../config/api.ts';
import type { ProductBackend } from './backend.ts';

/** Web is an online console: tokens live only in this tab, never localStorage. */
export async function createLiveBackend(): Promise<ProductBackend> {
  const memory = new Map<string, string>();
  const storage: SecureStorage = { getItemAsync: async key => memory.get(key) ?? null, setItemAsync: async (key, value) => { memory.set(key, value); }, deleteItemAsync: async key => { memory.delete(key); } };
  const sessions = new SessionManager(storage, { nowEpochMs: () => Date.now() });
  const http = new HttpClient({ sessions, baseUrl: apiBaseUrlFromEnv({ allowLocalHttp: __DEV__ }), allowLocalHttp: __DEV__, timeoutMs: 60_000 });
  const auth = new HttpAuthClient(http, sessions, productWireCodec);
  const gateway = new HttpAlarmGateway(http, sessions, productWireCodec);
  return {
    initialize: async () => {}, userId: () => sessions.view()?.authenticated ? sessions.view()!.userId : null,
    async authenticate(input, register) { await (register ? auth.register(input) : auth.login(input)); },
    async logout() { try { if (sessions.view()?.authenticated) await auth.logoutRemote(); } finally { await sessions.clear(); } },
    request: (path, method = 'GET', body) => http.authenticatedJson(path, method, body),
    submit: command => gateway.execute(operationNameOf(command), command),
    reconcile: async () => {}, decorate: alarms => alarms, pending: () => 0,
    subscribe: listener => sessions.subscribe(() => listener()),
    makePrimaryDevice: async () => 'Abre esta opción en la app Android instalada para elegir el móvil que activará tus avisos.',
    requestPermissions: async () => 'Estás en la vista web. Instala la app Android para activar alarmas y añadir el widget; aquí puedes proponer y responder.',
  };
}
