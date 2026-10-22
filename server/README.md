# Backend P3 - API, SQLite, sesiones y agente

Implementación objetivo de P3: **Node.js 22 + TypeScript estricto + Fastify + better-sqlite3**, sesiones propias, autorización por recurso, operaciones idempotentes, feed incremental, outbox y agente de borradores. Sustituye el scaffold de `functions/`; no usa Firebase Auth/Firestore/RNFirebase.

Estado: **implementación local verificada con 31 pruebas**. No hay VPS desplegado ni credenciales reales en este repositorio. La IA real es opcional; sin proveedor configurado el formulario manual sigue disponible (la API responde `TEMPORARY_UNAVAILABLE`).

## Arranque local

Requiere Node 22.13+ de la rama 22. Verificado en esta máquina con Node 22.23.4; con 22.13 el binario nativo de `better-sqlite3` puede fallar.

```sh
npm --prefix server ci
npm --prefix server run build
DATABASE_PATH=./data/alarmat.db npm --prefix server run migrate
DATABASE_PATH=./data/alarmat.db npm --prefix server start
# API en http://127.0.0.1:8787
```

En PowerShell:

```powershell
$env:DATABASE_PATH='./data/alarmat.db'
npm --prefix server run migrate
npm --prefix server start
```

`npm --prefix server run migrate` es obligatorio antes de servir; el proceso se niega a arrancar un esquema sin migrar. La base por defecto vive fuera del webroot (`server/data/`, ignorado por git). El servidor no carga `.env` por sí mismo: en el VPS las variables vienen de systemd/gestor de secretos (ver `deploy/alarmat.service`).

Comandos:

```sh
npm --prefix server run typecheck
npm --prefix server test          # build + SQLite temporal + Fastify inject
npm --prefix server run build
npm --prefix server run migrate
npm --prefix server start
npm --prefix server run backup -- <origen.db> <destino.db>
DEMO_PASSWORD='...' npm --prefix server run seed:demo
```

## Variables

Copiar `server/.env.example` como referencia. Nunca subir el `.env` real.

| Variable | Uso |
|---|---|
| `DATABASE_PATH` | Archivo SQLite privado en disco local. Por defecto `./data/alarmat.db`. |
| `SESSION_TTL_MS` | Duración de sesión; sin refresh en este corte. |
| `AUTH_RATE_LIMIT`, `OPERATION_RATE_LIMIT`, `AGENT_RATE_LIMIT` | Ventanas fijas en memoria por IP/actor. |
| `EXPO_PUSH_TOKEN`, `PUSH_WORKER_ENABLED` | Push opcional. Sin token la outbox queda persistida y no se promete entrega cerrada. |
| `AI_PROVIDER` | `none` (503), `deterministic` (solo demo/pruebas, etiquetado) u `openai`. |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | Proveedor compatible OpenAI, solo en el proceso del VPS. |
| `TRUST_PROXY` | `true` detrás de nginx para que `request.ip` use `X-Forwarded-For`. |

## API

Todas las rutas salvo `/health` y `/v1/auth/register|login` requieren `Authorization: Bearer <token opaco>`. El actor sale siempre de la sesión verificada; `actorUid`/`uid` enviados por el cliente no autorizan.

| Método y ruta | Contenido |
|---|---|
| `POST /v1/auth/register` | `{email, password, displayName}` → `{token, expiresAtEpochMs, user}`. Argon2id. |
| `POST /v1/auth/login` | Credenciales → sesión opaca nueva. |
| `GET /v1/auth/me` | Perfil público y expiración de sesión. |
| `POST /v1/auth/logout` | Revoca la sesión actual. |
| `POST /v1/groups` | `{name, timeZone}`; quien crea es `OWNER`. |
| `GET /v1/groups` | Pisos activos del actor y número de miembros. |
| `GET /v1/groups/:id/members` | Miembros activos visibles para un miembro. |
| `POST /v1/groups/:id/invitations` | Solo `OWNER`; devuelve el token una vez (hash en SQLite). |
| `POST /v1/invitations/:token/accept` | Consumo atómico de un solo uso y caducidad. |
| `DELETE /v1/groups/:id/members/:uid` | Solo `OWNER`; genera invalidación mínima para el retirado. |
| `POST /v1/groups/:id/leave` | Salida propia; el `OWNER` debe transferir/retirar antes. |
| `POST /v1/operations/:operationName` | `createAlarmRequest`, `respondToAlarm`, `reportSchedule`, `withdrawAlarmRequest`. |
| `GET /v1/groups/:id/alarm-requests` | Lista paginada (`limit`, `cursor`) filtrada a creador/destinatario. Devuelve `items[].recipient: null` para el creador. |
| `GET /v1/groups/:id/alarm-requests/:requestId` | Detalle autorizado con `schedules`; el creador recibe `recipient: null` y `recipients` (todos), el destinatario solo su decisión. |
| `GET /v1/groups/:id/alarm-requests/:requestId/schedules` | Acuses de programación visibles para participantes (DTO camelCase). |
| `POST /v1/alarms/:requestId/received` | `{requestVersion}`; acuse de recepción, no acepta ni programa; exige membresía activa. |
| `GET /v1/snapshot` | Grupos visibles, IDs de propuestas visibles y cursor inicial. |
| `GET /v1/sync?cursor=...&limit=...` | `changes` autorizados (`ALARM_REQUEST`, `RECIPIENT`, `SCHEDULE`, `GROUP_MEMBERSHIP`, `GROUP`, `DEVICE`) y `nextCursor` opaco ligado al actor. |
| `POST /v1/devices` | `{deviceId?, platform, pushToken?}`; el primero pasa a principal. |
| `POST /v1/devices/:deviceId/primary` | Cambia el principal e incrementa `deviceEpoch`. |
| `POST /v1/agent/propose` | `{groupId, text, sessionId?}` → aclaración o borrador revisable. |
| `GET /health` | Estado y versión de esquema. |

### Operaciones v1

Se conserva el sobre, los DTO, los enums y `OperationReceipt`/`AppError` de `contracts/`. Éxito devuelve el recibo directamente; error devuelve `AppError` directamente.

```json
{
  "schemaVersion": 1,
  "operationId": "op-una-vez-por-accion",
  "groupId": "grp-...",
  "entityId": "req-...",
  "expectedRequestVersion": 1,
  "expectedDecisionRevision": 1,
  "payload": {}
}
```

- `operationId` se conserva en reintentos. Mismo actor + ID + payload devuelve `REPLAYED`; mismo ID con otra operación/payload devuelve `409 VERSION_CONFLICT`. El recibo se comprueba antes de revalidar caducidad temporal, pero se vuelve a comprobar pertenencia y acceso antes de revelar el resultado.
- `createAlarmRequest` exige miembro activo, destinatarios activos distintos del emisor, instante futuro y `recurrence.localTime` igual al primer aviso. Crea `requestVersion = 1`; cada destinatario nace `PENDING` con `decisionRevision = 1`.
- `respondToAlarm` exige ser destinatario, versiones vigentes y una transición válida. `ACCEPTED` exige `consentScope`; la primera respuesta guarda `decisionRevision = 2`. Aceptar no programa: `PENDING_PERMISSION`/`SCHEDULED` llegan por el acuse del dispositivo.
- `withdrawAlarmRequest` exige creador y versión vigente; invalida consentimientos aceptados (`NEEDS_REVIEW`) y conserva el historial.
- `reportSchedule` exige destinatario, decisión aceptada vigente, modalidad igual a la propuesta, dispositivo principal y `deviceEpoch` vigente. `occurrenceId` debe ser `occ-<effectiveAtEpochMs>`. Una serie `SERIES` acepta la primera ocurrencia y las siguientes del mismo día/hora semanal; `FIRED`/`CANCELLED`/`EXPIRED`/`FAILED` son terminales para esa ocurrencia y un ACK no las revive. Los acuses no hacen retroceder un estado más reciente.
- `reportedAtEpochMs` no puede superar 5 minutos el reloj del servidor; un `FIRED` no puede declararse antes de su hora efectiva.

Dentro de la misma transacción SQLite se escribe el efecto, el recibo idempotente, los `change_events` y la outbox. No hay red, modelo ni `await` dentro de la transacción.

## Feed, revocaciones y outbox

- `change_events` se indexa por `(audience_uid, sequence)`. El cursor es opaco (`base64url`), ligado al actor y no otorga permisos. Al entregar se revalida la membresía; una baja se convierte en un evento `DELETE` de `GROUP_MEMBERSHIP`, mínimo y sin contenido nuevo.
- El cursor no caduca todavía; la retención y el snapshot completo quedan documentados como pendiente para P5.
- `outbox_events` se escribe en el commit y se procesa después. El worker usa lease, reintentos con backoff acotado (máximo 10 intentos) y tolera duplicados. Revalida membresía/destinatario antes de enviar; una baja posterior no recibe push.
- El push contiene solo IDs y versiones (`eventId`, `kind`, `groupId`, `entityType`, `entityId`, `entityVersion`). No incluye títulos, notas, motivos ni una orden para sonar.
- Sin `EXPO_PUSH_TOKEN` o con `PUSH_WORKER_ENABLED=false` no se llama a la red. El evento queda pendiente y P5 sincroniza al abrir/reanudar.
- Los receipts de Expo no se consultan en este corte; los tickets `DeviceNotRegistered` desactivan el token.

## Agente

`POST /v1/agent/propose` nunca acepta, programa ni envía. Devuelve:

```json
{
  "sessionId": "ags-...",
  "provider": "deterministic-demo",
  "status": "needs_clarification",
  "question": "¿A qué hora...?",
  "missingFields": ["time"]
}
```

o un `draft` con `title`, `recipientUids`, `timeSpec` IANA/UTC, `mode`, `reason`, `requiresSenderReview` y `requiresRecipientConsent`. El emisor revisa y usa la operación ordinaria `createAlarmRequest`; Ana responde con `respondToAlarm`.

- `AI_PROVIDER=none`: 503 explícito y formulario manual disponible.
- `AI_PROVIDER=deterministic`: adapter de demo/pruebas, claramente etiquetado; no es IA real.
- `AI_PROVIDER=openai`: cliente compatible OpenAI configurable. La clave vive solo en el entorno del VPS; no se registran prompts ni salidas completas.
- Las herramientas son lectura de miembros/tareas del grupo autorizado. Los nombres y textos son datos no confiables. La salida del modelo se valida con el contrato `createAlarmRequest` y pertenencia activa; un UID ajeno o un horario pasado se rechaza.
- Cada conversación queda aislada por propietario/grupo, caduca y solo guarda lo mínimo para continuar. Un borrador cierra la sesión; editar exige una nueva revisión.

## Seguridad y límites

- Contraseñas Argon2id (parámetros OWASP mínimos, reducibles solo en pruebas). Tokens de 32 bytes CSPRNG; solo se guarda SHA-256 en `sessions`.
- SQL parametrizado, FK, `CHECK`, WAL, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=FULL` verificado al abrir.
- CORS `*` para permitir la vista previa web local; no usa cookies ni credenciales. En producción puede restringirse en el reverse proxy.
- Rate limiting en memoria: válido para **un proceso**, no para varias réplicas.
- Sin refresh token, OAuth, recuperación de contraseña, SSE ni receipts de Expo en este corte.
- Push Android sigue necesitando credenciales FCM como transporte de Expo; no se reintroduce Firebase como backend.
- No se ha desplegado ningún VPS ni se han inventado hostname, dominio o credenciales.

## Despliegue y copias

1. Instalar Node 22, usuario sin privilegios `alarmat`, directorio de datos privado (`/var/lib/alarmat`, modo 0700) y código en `/opt/alarmat`.
2. `npm --prefix server ci && npm --prefix server run build`.
3. Copiar `deploy/alarmat.service` y `deploy/nginx.conf.example`, sustituir dominio/certificados y secretos.
4. `npm --prefix server run migrate` una sola vez por despliegue; después `systemctl enable --now alarmat`.
5. Backup consistente:

```sh
npm --prefix server run backup -- /var/lib/alarmat/alarmat.db /var/backups/alarmat/alarmat-$(date +%F).db
```

La copia usa `backup()` del driver y verifica `integrity_check` en el destino. No copies solo el `.db` abierto en WAL. Restaura en un archivo separado, valida `integrity_check` y solo entonces sustituye. Un rollback de aplicación no debe borrar la base: restaura una copia validada y reinicia. Las alarmas ya programadas en móviles pueden sobrevivir a una restauración antigua; hay que reconciliar clientes.

## Evidencia de verificación

```text
npm --prefix server run typecheck   -> OK
npm --prefix server test            -> 31 tests, 31 pass, 0 fail
```

Cubre: registro/login/logout y sesión revocada; invitaciones de un solo uso; límites; A/B/C con C sin acceso; un destinatario no puede ser suplantado; idempotencia y conflicto de payload; versión obsoleta; retirada invalida consentimiento; ACK antiguo no revive cancelación; epoch de dispositivo; series semanales; `FIRED` terminal; acuses monótonos; sync con cursor por actor; revocación de membresía; outbox con reintento, revalidación y token inválido; push sin contenido privado; registro concurrente; contratos reales de auth/list/detail/sync/schedules; agente con aclaración, ambigüedad, inyección, salida maliciosa y proveedor ausente.

No acredita: push real en un teléfono, VPS desplegado, IA real con proveedor, ni alarma sonando (P4/P5/P6).

## Handoff

- **P1:** añadir `server/` al workspace/CI (`npm --prefix server ci && npm --prefix server test`) y retirar `functions/`/`firebase/` cuando los consumidores estén migrados. No se tocaron scripts raíz ni CI.
- **P2:** consumir los estados y el contrato de borrador/aclaración; no mostrar “programada” sin acuse válido.
- **P5:** usar `GET /v1/snapshot` + `GET /v1/sync`, guardar cursor/lote atómicamente, token en SecureStore, outbox propia y `POST /v1/alarms/:id/received`; no abrir la base del VPS. Los parsers compartidos (`parseAuthResponse`, `parseSyncPage`, `parseAlarmRequestPage`, `parseAlarmRequestDetail`, `parseScheduleDocument`) ya aceptan las respuestas reales del servidor.
- **P6:** `DEMO_PASSWORD='...' node server/scripts/seed-demo.mjs` contra la API local; el seed no demuestra push ni sonido.
- **P3/VPS:** cuando existan host, dominio y certificados reales, completar TLS, systemd, backup/restauración y prueba desde dos móviles.

## Pendiente explícito

- Endpoints de tareas (`createTask`/`completeTask`/`cancelTask`). La serie semanal ya acepta y reporta ocurrencias; la materialización local sigue siendo P4/P5.
- SSE, receipts Expo, retención/caducidad de cursores y snapshot incremental completo.
- Transferencia de propiedad del grupo, recuperación de contraseña, refresh de sesión y verificación de correo.
- Prueba HTTPS desde dispositivos y despliegue real.

## Integración de producto y cliente móvil

La [hoja de compatibilidad P2/P5/P6](docs/PRODUCT_INTEGRATION.md) documenta tareas idempotentes, proyección `/sync?projection=alarms`, aliases de UI, CORS explícito y OpenRouter real sobre estos mismos servicios y esta misma SQLite. Se aplica la migración 002 sin modificar la migración 001 publicada.
