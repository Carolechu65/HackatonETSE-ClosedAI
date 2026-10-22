/**
 * Seed de demo A/B/C contra la API local. No crea secretos en git.
 * Requiere el servidor arrancado y DEMO_PASSWORD en el entorno.
 */
const apiUrl = (process.env.API_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const password = process.env.DEMO_PASSWORD;
const groupName = process.env.DEMO_GROUP_NAME ?? 'Piso Demo';

if (!password || password.length < 10) {
  console.error('Define DEMO_PASSWORD (mínimo 10 caracteres). No se guarda en el repositorio.');
  process.exit(1);
}

const people = [
  { name: 'Luis', email: 'luis@demo.alarmat.test' },
  { name: 'Ana', email: 'ana@demo.alarmat.test' },
  { name: 'Vecino', email: 'vecino@demo.alarmat.test' },
];

async function call(method, path, token, body) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* respuesta no JSON */ }
  return { status: response.status, json };
}

async function registerOrLogin(person) {
  const register = await call('POST', '/v1/auth/register', null, {
    email: person.email,
    password,
    displayName: person.name,
  });
  if (register.status === 201) return register.json;
  const login = await call('POST', '/v1/auth/login', null, { email: person.email, password });
  if (login.status !== 200) {
    throw new Error(`No se pudo registrar ni entrar como ${person.email}: ${login.status}`);
  }
  return login.json;
}

async function ensureGroup(owner) {
  const groups = await call('GET', '/v1/groups', owner.token);
  if (groups.status !== 200) throw new Error(`/v1/groups: ${groups.status}`);
  const existing = groups.json.groups.find((group) => group.name === groupName);
  if (existing) return existing.groupId;
  const created = await call('POST', '/v1/groups', owner.token, { name: groupName, timeZone: 'Europe/Madrid' });
  if (created.status !== 201) throw new Error(`crear grupo: ${created.status}`);
  return created.json.groupId;
}

async function ensureMember(owner, groupId, person) {
  const members = await call('GET', `/v1/groups/${groupId}/members`, owner.token);
  if (members.status !== 200) throw new Error(`miembros: ${members.status}`);
  if (members.json.members.some((member) => member.uid === person.user.uid)) return;
  const invitation = await call('POST', `/v1/groups/${groupId}/invitations`, owner.token, {});
  if (invitation.status !== 201) throw new Error(`invitación: ${invitation.status}`);
  const accepted = await call('POST', `/v1/invitations/${invitation.json.token}/accept`, person.token);
  if (accepted.status !== 200) throw new Error(`aceptar invitación: ${accepted.status}`);
}

function futureTimeSpec() {
  const now = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localDate = `${values.year}-${values.month}-${values.day}`;
  let guess = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), 21, 0);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const localValues = Object.fromEntries(local.map((part) => [part.type, part.value]));
    const actual = Date.UTC(
      Number(localValues.year), Number(localValues.month) - 1, Number(localValues.day),
      Number(localValues.hour), Number(localValues.minute),
    );
    const desired = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), 21, 0);
    if (actual === desired) break;
    guess += desired - actual;
  }
  return { timeZone: 'Europe/Madrid', localDate, localTime: '21:00', effectiveAtEpochMs: guess };
}

const [luis, ana, vecino] = await Promise.all(people.map(registerOrLogin));
const groupId = await ensureGroup(luis);
await ensureMember(luis, groupId, ana);
await ensureMember(luis, groupId, vecino);

const existing = await call('GET', `/v1/groups/${groupId}/alarm-requests`, luis.token);
if (existing.status !== 200) throw new Error(`propuestas: ${existing.status}`);
if (existing.json.items.length === 0) {
  const operationId = `op-seed-${Date.now()}`;
  const created = await call('POST', '/v1/operations/createAlarmRequest', luis.token, {
    schemaVersion: 1,
    operationId,
    groupId,
    payload: {
      title: 'Sacar la basura',
      note: 'Seed de demo; Ana decide en su móvil.',
      recipientUids: [ana.user.uid],
      mode: 'ALARM',
      timeSpec: futureTimeSpec(),
    },
  });
  if (created.status !== 200) throw new Error(`crear propuesta: ${created.status} ${JSON.stringify(created.json)}`);
}

console.log(JSON.stringify({
  apiUrl,
  groupId,
  users: people.map((person) => ({ displayName: person.name, email: person.email })),
  passwordSource: 'DEMO_PASSWORD',
}, null, 2));
