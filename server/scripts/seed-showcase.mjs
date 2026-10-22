/** Seed persistente de dos usuarios. Credenciales/estado fuera del repositorio.
 * Uso: node server/scripts/seed-showcase.mjs /ruta/privada/state.json
 * El estado conserva fechas y operationId para reintentos sin duplicados.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const statePath = process.argv[2];
if (!statePath) throw new Error('Indica el archivo privado de estado.');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const api = state.apiUrl;
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
state.operations ??= {};
state.groups ??= [];
state.tasks ??= {};
state.alarms ??= {};
function op(key) { state.operations[key] ??= `op-demo-${randomUUID()}`; save(); return state.operations[key]; }
async function call(method, path, token, body) {
  const response = await fetch(`${api}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(json)}`);
  return json;
}
const sessions = [];
try {
  for (const person of state.users) {
    const session = await call('POST', person.registered ? '/v1/auth/login' : '/v1/auth/register', null,
      { email: person.email, password: person.password, ...(!person.registered ? { displayName: person.displayName } : {}) });
    sessions.push(session); person.registered = true; person.uid = session.user.uid; save();
  }
  const names = ['DEMO · Piso Aurora', 'DEMO · Casa del Mar'];
  for (let g = 0; g < names.length; g++) {
    const owner = sessions[g], member = sessions[1 - g];
    const existing = await call('GET', '/v1/groups', owner.token);
    const group = existing.groups.find(item => item.name === names[g]) ??
      await call('POST', '/v1/groups', owner.token, { name: names[g], timeZone: 'Europe/Madrid' });
    const groupId = group.groupId;
    state.groups[g] = { groupId, name: names[g] }; save();
    const members = await call('GET', `/v1/groups/${groupId}/members`, owner.token);
    if (!members.members.some(item => item.uid === member.user.uid)) {
      const invite = await call('POST', `/v1/groups/${groupId}/invitations`, owner.token, {});
      await call('POST', `/v1/invitations/${invite.token}/accept`, member.token);
    }
    const titles = g === 0 ? [
      'Reponer café y leche', 'Sacar reciclaje', 'Limpiar la cocina', 'Regar las plantas',
      'Comprar fruta para la semana', 'Revisar bombilla del pasillo', 'Organizar cena del viernes',
      'Lavar toallas', 'Ordenar el salón', 'Cambiar sábanas', 'Comprar detergente', 'Pintar la terraza',
    ] : [
      'Preparar lista de equipaje', 'Comprar agua y aperitivos', 'Revisar llaves de repuesto', 'Regar jardín',
      'Limpiar barbacoa', 'Preparar habitaciones', 'Planificar excursión', 'Recoger tumbonas',
      'Ventilar la casa', 'Guardar ropa de verano', 'Revisar botiquín', 'Reservar excursión en barco',
    ];
    const categories = ['Compra', 'Limpieza', 'Mantenimiento', 'Convivencia'];
    for (let i = 0; i < titles.length; i++) {
      const key = `${g}-task-${i}`;
      if (state.tasks[key]) continue;
      const offsetHours = [-18, 3, 6, 24, 48, 72, 96, 120, -24, -48, -72, 168][i];
      const draft = {
        operationId: op(key), title: `[DEMO] ${titles[i]}`,
        description: 'Datos ficticios de demostración. Puedes completar esta tarea y comprobar el cambio en la otra cuenta.',
        category: categories[i % categories.length], assigneeUid: i % 4 === 3 ? null : sessions[i % 2].user.uid,
        dueAtEpochMs: state.baseTime + offsetHours * 3600000,
        activateAtEpochMs: i === 7 ? state.baseTime + 96 * 3600000 : null,
      };
      let task = await call('POST', `/v1/groups/${groupId}/tasks`, sessions[i % 2].token, draft);
      if (i >= 8) task = await call('PATCH', `/v1/groups/${groupId}/tasks/${task.id}`, sessions[i % 2].token,
        { operationId: op(`${key}-close`), status: i === 11 ? 'cancelled' : 'completed', expectedVersion: 1 });
      state.tasks[key] = task; save();
    }
    const alarmTitles = g === 0 ? [
      'Sacar el reciclaje esta tarde', 'Preparar la cena juntos', 'Regar plantas cada semana',
      'Poner la lavadora', 'Silencio para estudiar', 'Compra semanal', 'Revisar el horno',
      'Cambio de planes: limpieza', 'Recordar las llaves', 'Reponer café mañana',
    ] : [
      'Preparar el equipaje', 'Cerrar ventanas al salir', 'Regar jardín cada semana',
      'Salir hacia la playa', 'Organizar la barbacoa', 'Revisar la reserva', 'Apagar luces exteriores',
      'Excursión cancelada', 'Recoger las llaves', 'Comprar agua mañana',
    ];
    for (let i = 0; i < alarmTitles.length; i++) {
      const key = `${g}-alarm-${i}`;
      if (state.alarms[key]) continue;
      const sender = sessions[i % 2], recipient = sessions[1 - i % 2];
      const timeSpec = timeAt(state.baseTime + (24 + i * 12) * 3600000);
      const weekly = i === 2 || i === 5;
      const payload = {
        title: `[DEMO] ${alarmTitles[i]}`,
        note: 'Ejemplo ficticio para explorar el flujo entre dos cuentas. La aceptación no acredita que un dispositivo haya programado la alarma.',
        recipientUids: [recipient.user.uid], mode: i % 3 === 1 ? 'NOTIFICATION' : 'ALARM', timeSpec,
        ...(i < 2 ? { taskId: state.tasks[`${g}-task-${i}`].id } : {}),
        ...(weekly ? { recurrence: { kind: 'WEEKLY', isoWeekday: new Date(`${timeSpec.localDate}T12:00:00Z`).getUTCDay() || 7, localTime: timeSpec.localTime } } : {}),
      };
      const created = await call('POST', '/v1/operations/createAlarmRequest', sender.token,
        { schemaVersion: 1, operationId: op(key), groupId, payload });
      const entityId = created.result.requestId;
      const respond = (decision, revision, suffix, extra = {}) => call('POST', '/v1/operations/respondToAlarm', recipient.token, {
        schemaVersion: 1, operationId: op(`${key}-${suffix}`), groupId, entityId,
        expectedRequestVersion: 1, expectedDecisionRevision: revision, payload: { decision, ...extra },
      });
      if ([2, 3, 5, 6, 7].includes(i)) await respond('ACCEPTED', 1, 'accept', {
        consentScope: weekly ? 'SERIES' : 'THIS_OCCURRENCE',
        ...(i === 3 ? { chosenTimeSpec: timeAt(timeSpec.effectiveAtEpochMs + 3600000) } : {}),
      });
      if (i === 4) await respond('REJECTED', 1, 'reject', { reason: 'DEMO: no me viene bien esta hora.' });
      if (i === 6) await respond('DISABLED', 2, 'disable', { reason: 'DEMO: aviso desactivado por el destinatario.' });
      if (i === 7) await call('POST', '/v1/operations/withdrawAlarmRequest', sender.token, {
        schemaVersion: 1, operationId: op(`${key}-withdraw`), groupId, entityId,
        expectedRequestVersion: 1, payload: { reason: 'DEMO: cambio de planes del emisor.' },
      });
      state.alarms[key] = { requestId: entityId, title: payload.title }; save();
    }
  }
  const verification = [];
  for (const session of sessions) {
    const { groups } = await call('GET', '/v1/groups', session.token);
    for (const group of state.groups) {
      if (!groups.some(item => item.groupId === group.groupId)) throw new Error('Falta pertenencia al grupo');
      const { tasks } = await call('GET', `/v1/groups/${group.groupId}/tasks`, session.token);
      const { items } = await call('GET', `/v1/groups/${group.groupId}/alarm-requests?limit=50`, session.token);
      if (tasks.length !== 12 || items.length !== 10) throw new Error('Recuento inesperado');
      verification.push({ user: session.user.email, group: group.name, tasks: tasks.length, alarms: items.length,
        pendingResponses: items.filter(item => item.request.status === 'ACTIVE' && item.recipient?.decision === 'PENDING').length });
    }
  }
  state.verifiedAt = new Date().toISOString(); save();
  console.log(JSON.stringify(verification, null, 2));
} finally {
  for (const session of sessions) await call('POST', '/v1/auth/logout', session.token).catch(() => {});
}

function timeAt(epoch) {
  const effectiveAtEpochMs = Math.ceil(epoch / 60000) * 60000;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(effectiveAtEpochMs)).map(item => [item.type, item.value]));
  return { timeZone: 'Europe/Madrid', localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localTime: `${parts.hour}:${parts.minute}`, effectiveAtEpochMs };
}
