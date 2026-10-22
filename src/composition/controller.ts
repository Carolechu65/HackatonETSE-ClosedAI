import { createCalendarClient } from '../features/calendar/client.ts';
import type { CreateAlarmRequestPayload, RespondToAlarmPayload, AlarmCommand } from '../domain/contracts/types.ts';
import { parseAlarmRequestDocument, parseRecipientDocument, parseScheduleDocument, parseCreateAlarmRequest, parseRespondToAlarm } from '../domain/contracts/validate.ts';
import { createTask, completeTask, cancelTask, validateTaskDraft, type HouseholdTask, type TaskDraft } from '../features/tasks/model.ts';
import { createIdGenerator } from '../domain/ids.ts';
import { isValidTimeZone } from '../domain/time.ts';
import { DomainError } from '../domain/errors.ts';
import { demoProductState } from './demo.ts';
import { initialProductState, type ProductState, type ProductClient, type Group, type Member, type ProductAlarm, type AssistantReply } from './product.ts';
import type { ProductBackend } from './backend.ts';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('La respuesta no tiene el formato esperado.');
  return value as Record<string, unknown>;
}
function text(value: unknown): string { if (typeof value !== 'string' || !value.length) throw new Error('La respuesta está incompleta.'); return value; }
function list(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error('La respuesta no contiene una lista válida.'); return value; }
function decodeGroups(value: unknown): Group[] { return list(record(value).groups).map(item => { const row = record(item); return { id: text(row.id ?? row.groupId), name: text(row.name), timeZone: text(row.timeZone), role: text(row.role).toLowerCase() }; }); }
function decodeMembers(value: unknown): Member[] { return list(record(value).members).map(item => { const row = record(item); return { userId: text(row.userId ?? row.uid), displayName: text(row.displayName), role: text(row.role).toLowerCase() }; }); }
function decodeTasks(value: unknown, groupId: string): HouseholdTask[] {
  return list(record(value).tasks).map(item => {
    const row = record(item);
    if (row.groupId !== groupId || !['pending', 'completed', 'cancelled'].includes(String(row.status)) || !Number.isSafeInteger(row.version)) throw new Error('La tarea no pertenece al piso actual.');
    text(row.id); text(row.title); text(row.createdByUid);
    return row as unknown as HouseholdTask;
  });
}
export function decodeProductAlarms(value: unknown, groupId: string, userId: string): ProductAlarm[] {
  const result = new Map<string, ProductAlarm>();
  const root = record(value);
  for (const item of list(root.alarms ?? root.items)) {
    const row = record(item); const requestId = text(row.requestId); const request = parseAlarmRequestDocument(row.request);
    const recipient = parseRecipientDocument(row.recipient);
    if (row.groupId !== groupId || (request.creatorUid !== userId && recipient.uid !== userId)) throw new Error('La propuesta no pertenece a esta sesión.');
    const schedules = list(row.schedules).map(parseScheduleDocument);
    const old = result.get(requestId);
    if (old) { old.recipients.push(recipient); old.schedulesByRecipient![recipient.uid] = schedules; if (recipient.uid === userId) old.schedules = schedules; }
    else result.set(requestId, { groupId, requestId, request, recipients: [recipient], schedulesByRecipient: { [recipient.uid]: schedules }, schedules: recipient.uid === userId ? schedules : [] });
  }
  return [...result.values()];
}

export function createProductController(backendFactory: () => Promise<ProductBackend>): ProductClient {
  let state: ProductState = { ...initialProductState };
  const listeners = new Set<() => void>(); const ids = createIdGenerator();
  let backend: ProductBackend | undefined; let backendPromise: Promise<ProductBackend> | undefined; let initialization: Promise<void> | undefined;
  let authentication: Promise<void> | undefined;
  let generation = 0; let flight: Promise<void> | undefined;
  const appliedDemoOperations = new Map<string, { payload: string; result: string | null }>();
  const set = (patch: Partial<ProductState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const ensureBackend = async () => { backendPromise ??= backendFactory().catch(error => { backendPromise = undefined; throw error; }); backend ??= await backendPromise; return backend; };
  const assertGeneration = (expected: number) => { if (expected !== generation) throw new DomainError('UNAUTHENTICATED', 'La sesión o el piso ha cambiado.'); };
  const requireGroup = () => { if (!state.session || !state.groupId) throw new Error('Selecciona un piso para continuar.'); return state.groupId; };
  const isDemo = () => state.session?.mode === 'demo';
  const replay = (operationId: string, payload: unknown) => {
    const previous = appliedDemoOperations.get(operationId);
    if (previous && previous.payload !== JSON.stringify(payload)) throw new Error('La operación ya se usó con otros datos.');
    return previous;
  };
  const remember = (operationId: string, payload: unknown, result: string | null = null) => appliedDemoOperations.set(operationId, { payload: JSON.stringify(payload), result });
  const submit = async (command: AlarmCommand) => {
    const expected = generation; const api = await ensureBackend();
    try { const receipt = await api.submit(command); assertGeneration(expected); await refresh(); return receipt; }
    catch (error) {
      if (expected === generation) { set({ alarms: api.decorate(state.alarms), pending: api.pending() }); if (error instanceof DomainError && error.code === 'VERSION_CONFLICT') await refresh().catch(() => undefined); }
      throw error;
    }
  };
  async function loadGroup(api: ProductBackend, groupId: string, expected: number, groups: Group[]) {
    const [members, alarms, tasks, profile] = await Promise.all([
      api.request(`/v1/groups/${encodeURIComponent(groupId)}/members`), api.request(`/v1/groups/${encodeURIComponent(groupId)}/alarms`),
      api.request(`/v1/groups/${encodeURIComponent(groupId)}/tasks`), api.request('/v1/auth/me'),
    ]);
    assertGeneration(expected); const userId = api.userId(); if (!userId) throw new DomainError('UNAUTHENTICATED', 'Inicia sesión de nuevo.');
    const user = record(record(profile).user ?? profile);
    await api.selectGroup?.(groupId); assertGeneration(expected);
    set({ session: { userId, displayName: typeof user.displayName === 'string' ? user.displayName : 'Tú', mode: 'live' }, groups, groupId,
      members: decodeMembers(members), alarms: api.decorate(decodeProductAlarms(alarms, groupId, userId)), tasks: decodeTasks(tasks, groupId), lastSync: Date.now(), pending: api.pending(), error: null });
  }
  async function refresh(): Promise<void> {
    if (isDemo()) return;
    if (flight) return flight;
    const expected = generation;
    flight = (async () => {
      set({ syncing: true });
      try {
        const api = await ensureBackend(); if (!api.userId()) return;
        await api.reconcile(); assertGeneration(expected);
        const groups = decodeGroups(await api.request('/v1/groups')); assertGeneration(expected);
        const groupId = groups.some(group => group.id === state.groupId) ? state.groupId : groups[0]?.id ?? null;
        if (groupId) await loadGroup(api, groupId, expected, groups);
        else { const envelope = record(await api.request('/v1/auth/me')); const profile = record(envelope.user ?? envelope); assertGeneration(expected); set({ session: { userId: api.userId()!, displayName: typeof profile.displayName === 'string' ? profile.displayName : 'Tú', mode: 'live' }, groups, groupId: null, alarms: [], tasks: [], members: [], error: null, lastSync: Date.now() }); }
      } catch (error) {
        if (expected === generation) {
          if (error instanceof DomainError && error.code === 'UNAUTHENTICATED') set({ session: null, groups: [], groupId: null, alarms: [], members: [], tasks: [], error: 'La sesión ha caducado. Vuelve a entrar.' });
          else {
            const cached = error instanceof DomainError && error.code === 'TEMPORARY_UNAVAILABLE' ? backend?.cached?.() : undefined;
            if (cached && cached.userId === backend?.userId()) {
              const groups = state.groups.length ? state.groups : [...new Set(cached.alarms.map(alarm => alarm.groupId))].map(id => ({ id, name: 'Mi piso · sin conexión', timeZone: cached.alarms.find(alarm => alarm.groupId === id)!.request.timeSpec.timeZone, role: 'member' }));
              const groupId = state.groupId ?? groups[0]?.id ?? null;
              set({ session: state.session ?? { userId: cached.userId, displayName: 'Tú', mode: 'live' }, groups, groupId,
                alarms: cached.alarms.filter(alarm => alarm.groupId === groupId), lastSync: cached.lastSync, pending: backend?.pending() ?? 0 });
            }
            set({ error: cached ? 'Sin conexión. Mostramos los avisos guardados en este dispositivo; los cambios esperan sincronización.' : error instanceof Error ? error.message : 'No se pudo sincronizar.' });
          }
        }
        throw error;
      } finally { if (expected === generation) set({ syncing: false }); flight = undefined; }
    })();
    return flight;
  }
  return {
    calendar: createCalendarClient(async (path, method, body) => {
      if (!state.session || isDemo()) throw new DomainError('UNAUTHENTICATED', 'Entra con tu cuenta para conectar tu calendario.');
      const expected = generation; const api = await ensureBackend();
      const result = await api.request(path, method, body); assertGeneration(expected); return result;
    }),
    getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    initialize() {
      initialization ??= (async () => {
        try {
          // A public URL is optional: the isolated demo remains usable without a server.
          if (!process.env.EXPO_PUBLIC_API_URL) return;
          const api = await ensureBackend(); await api.initialize();
          api.subscribe(() => { if (!isDemo() && state.session) { if (!api.userId()) set({ session: null, alarms: [], tasks: [], members: [], groups: [], groupId: null }); else set({ alarms: api.decorate(state.alarms), pending: api.pending() }); } });
          if (api.cleanupPending?.()) set({ cleanupPending: true, error: 'El cierre anterior está pendiente. Reintenta retirar los avisos y limpiar el widget.' });
          else if (api.userId()) await refresh();
        } catch (error) { set({ error: error instanceof Error ? error.message : 'No se pudo restaurar la sesión.' }); }
        finally { set({ ready: true }); }
      })(); return initialization;
    },
    signIn(input, register) {
      if (state.cleanupPending) return Promise.reject(new Error('Reintenta el cierre anterior antes de entrar con otra cuenta.'));
      const expected = ++generation; set({ error: null });
      const pending = (async () => {
        const api = await ensureBackend(); await api.initialize(); assertGeneration(expected);
        await api.authenticate(input, register); assertGeneration(expected);
        set({ session: { userId: api.userId()!, displayName: input.displayName || 'Tú', mode: 'live' }, groups: [], groupId: null, alarms: [], tasks: [], members: [], ready: true });
        await refresh();
      })();
      authentication = pending;
      return pending.finally(() => { if (authentication === pending) authentication = undefined; });
    },
    async startDemo() {
      ++generation;
      await authentication?.catch(() => undefined);
      await initialization?.catch(() => undefined);
      if (backend?.userId() || backend?.cleanupPending?.()) await backend!.logout();
      appliedDemoOperations.clear(); set({ ...demoProductState(), cleanupPending: false });
    },
    async signOut() {
      ++generation;
      await authentication?.catch(() => undefined);
      try { if (!isDemo() && backend) await backend.logout(); }
      catch (error) {
        set({ ...initialProductState, ready: true, cleanupPending: true, error: 'El cierre está pendiente. Reintenta retirar los avisos y limpiar el widget antes de cambiar de cuenta.' });
        throw error;
      }
      appliedDemoOperations.clear(); set({ ...initialProductState, ready: true, cleanupPending: false });
    },
    refresh,
    async selectGroup(id) {
      if (!state.groups.some(group => group.id === id)) throw new Error('No tienes acceso a este piso.');
      if (id === state.groupId) return;
      ++generation; set({ groupId: id, members: [], alarms: [], tasks: [], error: null });
      if (!isDemo()) { await flight?.catch(() => undefined); await refresh(); }
    },
    async createGroup(name, timeZone) {
      if (!name.trim() || !isValidTimeZone(timeZone)) throw new Error('Indica un nombre y una zona horaria válida.');
      if (isDemo()) { const group: Group = { id: ids.next('demo-group'), name, timeZone, role: 'owner' }; set({ groups: [...state.groups, group], groupId: group.id, alarms: [], tasks: [], members: [{ userId: state.session!.userId, displayName: state.session!.displayName, role: 'owner' }] }); return; }
      const expected = generation; const api = await ensureBackend(); const group = record(await api.request('/v1/groups', 'POST', { name, timeZone })); assertGeneration(expected);
      set({ groupId: text(group.id ?? group.groupId) }); await refresh();
    },
    async createInvitation() {
      const id = requireGroup(); if (isDemo()) throw new Error('Las invitaciones son reales al conectar tu cuenta. Sal de la demo para crear una.');
      const expected = generation; const api = await ensureBackend(); const response = record(await api.request(`/v1/groups/${id}/invitations`, 'POST', {})); assertGeneration(expected); return text(response.token);
    },
    async joinGroup(token) {
      if (isDemo()) throw new Error('Entra con tu cuenta para usar una invitación real.');
      const expected = generation; const api = await ensureBackend(); const result = record(await api.request('/v1/invitations/accept', 'POST', { token })); assertGeneration(expected); set({ groupId: text(result.id ?? result.groupId) }); await refresh();
    },
    async createAlarm(payload, operationId) {
      const groupId = requireGroup(); const command = parseCreateAlarmRequest({ schemaVersion: 1, operationId, groupId, payload }, { nowEpochMs: Date.now() });
      if (isDemo()) {
        const previous = replay(operationId, command); if (previous) return previous.result;
        const id = ids.next('demo-alarm'); const now = Date.now();
        set({ alarms: [{ groupId, requestId: id, request: { ...payload, creatorUid: state.session!.userId, requestVersion: 1, status: 'ACTIVE', createdAtEpochMs: now, updatedAtEpochMs: now }, recipients: payload.recipientUids.map(uid => ({ uid, receivedVersion: 1, reception: 'NOT_ACKNOWLEDGED', decision: 'PENDING', decisionRevision: 1, updatedAtEpochMs: now })), schedules: [] }, ...state.alarms] });
        remember(operationId, command, id); return id;
      }
      const receipt = await submit(command); return typeof receipt.result?.requestId === 'string' ? receipt.result.requestId : null;
    },
    async respond(alarm, payload, operationId) {
      const groupId = requireGroup(); const recipient = alarm.recipients.find(item => item.uid === state.session!.userId);
      if (!recipient) throw new Error('Solo la persona destinataria puede responder.');
      const command = parseRespondToAlarm({ schemaVersion: 1, operationId, groupId, entityId: alarm.requestId, expectedRequestVersion: alarm.request.requestVersion, expectedDecisionRevision: recipient.decisionRevision, payload }, { nowEpochMs: Date.now() });
      if (!isDemo()) { await submit(command); return; }
      if (replay(operationId, command)) return;
      const current = state.alarms.find(item => item.requestId === alarm.requestId); const currentRecipient = current?.recipients.find(item => item.uid === recipient.uid);
      if (!current || current.request.requestVersion !== alarm.request.requestVersion || currentRecipient?.decisionRevision !== recipient.decisionRevision) throw new Error('La propuesta ha cambiado. Revisa los datos antes de responder.');
      set({ alarms: state.alarms.map(item => item.requestId !== alarm.requestId ? item : { ...item, schedules: [], recipients: item.recipients.map(entry => entry.uid !== recipient.uid ? entry : { uid: entry.uid, receivedVersion: item.request.requestVersion, reception: 'RECEIVED', decision: payload.decision, decisionRevision: entry.decisionRevision + 1, updatedAtEpochMs: Date.now(), ...(payload.decision === 'ACCEPTED' ? { acceptedRequestVersion: item.request.requestVersion, consentScope: payload.consentScope, chosenTimeSpec: payload.chosenTimeSpec } : {}) }) }) }); remember(operationId, command);
    },
    async withdraw(alarm, operationId) {
      if (alarm.request.creatorUid !== state.session?.userId) throw new Error('Solo quien propuso el aviso puede retirarlo.');
      const command = { schemaVersion: 1 as const, operationId, groupId: requireGroup(), entityId: alarm.requestId, expectedRequestVersion: alarm.request.requestVersion, payload: { reason: 'Retirada por quien la propuso' } };
      if (!isDemo()) { await submit(command); return; }
      if (replay(operationId, command)) return;
      set({ alarms: state.alarms.map(item => item.requestId === alarm.requestId ? { ...item, request: { ...item.request, status: 'WITHDRAWN', requestVersion: item.request.requestVersion + 1 }, schedules: [] } : item) }); remember(operationId, command);
    },
    async createTask(draft: TaskDraft, operationId) {
      const groupId = requireGroup(); const members = state.members.map(member => ({ uid: member.userId, status: 'active' as const })); const normalized = validateTaskDraft(draft, members);
      if (isDemo()) { const previous = replay(operationId, draft); if (previous) return previous.result!; const task = createTask({ id: ids.next('demo-task'), groupId, createdByUid: state.session!.userId, draft: normalized, members }); set({ tasks: [task, ...state.tasks] }); remember(operationId, draft, task.id); return task.id; }
      const expected = generation; const api = await ensureBackend(); const result = record(await api.request(`/v1/groups/${groupId}/tasks`, 'POST', { ...normalized, operationId })); assertGeneration(expected); await refresh(); return text(result.id);
    },
    async updateTask(task, status, operationId) {
      const groupId = requireGroup(); if (task.groupId !== groupId) throw new Error('La tarea no pertenece al piso actual.');
      if (isDemo()) {
        const payload = { taskId: task.id, version: task.version, status }; if (replay(operationId, payload)) return;
        const mutate = status === 'completed' ? completeTask : cancelTask;
        const updated = mutate(task, { actorUid: state.session!.userId, members: state.members.map(member => ({ uid: member.userId, status: 'active' })), nowEpochMs: Date.now() }).task;
        set({ tasks: state.tasks.map(item => item.id === task.id ? updated : item), alarms: state.alarms.map(alarm => alarm.request.taskId === task.id ? { ...alarm, request: { ...alarm.request, status: 'WITHDRAWN' }, schedules: [] } : alarm) }); remember(operationId, payload); return;
      }
      const expected = generation; const api = await ensureBackend(); await api.request(`/v1/groups/${groupId}/tasks/${task.id}`, 'POST', { status, expectedVersion: task.version, operationId }); assertGeneration(expected); await refresh();
    },
    async askAssistant(input, conversationId): Promise<AssistantReply> {
      const groupId = requireGroup(); if (isDemo()) throw new Error('Conecta tu cuenta para conversar con el asistente real. La demo no simula respuestas de IA.');
      const expected = generation; const api = await ensureBackend(); const result = record(await api.request('/v1/agent/draft', 'POST', { groupId, text: input, conversationId })); assertGeneration(expected);
      if (result.status === 'needs_clarification') return { kind: 'needs_clarification', message: text(result.question), conversationId: text(result.conversationId) };
      if (result.status !== 'draft') throw new Error('El asistente no ha devuelto una propuesta válida.');
      const draft = parseCreateAlarmRequest({ schemaVersion: 1, operationId: ids.next(), groupId, payload: result.draft }, { nowEpochMs: Date.now() }).payload;
      return { kind: 'draft', message: 'He preparado esta propuesta. Revisa destinatarios, hora y modalidad antes de enviarla.', draft, conversationId: text(result.conversationId) };
    },
    async makePrimaryDevice() { if (isDemo()) return 'La demo no cambia dispositivos. Conecta tu cuenta en Android.'; return (await ensureBackend()).makePrimaryDevice(); },
    async requestPermissions() { if (isDemo()) return 'La demo no solicita permisos. Conecta tu cuenta en la app Android para activar avisos.'; return (await ensureBackend()).requestPermissions(); },
  };
}
