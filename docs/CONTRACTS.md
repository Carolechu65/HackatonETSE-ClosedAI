# Contratos de datos y API · v1

Guía de uso de [`contracts/`](../contracts/README.md) para P2, P3, P4, P5 y P6. Es un resumen operativo; la referencia normativa sigue siendo el [TDD](TDD.md#5-contratos-de-datos-y-api).

## 1. Sobre común

```json
{
  "schemaVersion": 1,
  "operationId": "op-create-0001",
  "groupId": "piso-demo",
  "entityId": "req-001",
  "expectedRequestVersion": 2,
  "expectedDecisionRevision": 1,
  "payload": {}
}
```

- `operationId` lo genera el cliente **una vez por acción** y se conserva en cada reintento. Reutilizarlo con otro payload es un error.
- `entityId` y las versiones esperadas solo son obligatorias en las operaciones que modifican una propuesta existente.
- El servidor obtiene el actor de la sesión bearer opaca validada contra `sessions` en SQLite del VPS; no existe `request.auth.uid` de Firebase en la API objetivo. `actorUid` en el cuerpo se rechaza (`invalid/operation-envelope.client-actor-uid.json`).
- Respuesta común: `OperationReceipt` (`APPLIED` o `REPLAYED`, `serverTimeEpochMs`, versiones nuevas). Los fallos usan `AppError` con un `code` del contrato.

## 2. Operaciones

| Operación | Payload | Precondición |
|---|---|---|
| `createAlarmRequest` | `title`, `note?`, `taskId?`, `recipientUids[1..6]`, `mode`, `timeSpec`, `recurrence?` | Miembro activo; destinatarios activos del grupo; instante futuro. Crea `requestVersion = 1`. |
| `respondToAlarm` | `decision` (`ACCEPTED`/`REJECTED`/`DISABLED`), `consentScope?`, `chosenTimeSpec?`, `reason?` | Solo el destinatario; `expectedRequestVersion` y `expectedDecisionRevision` vigentes. |
| `reportSchedule` | `occurrenceId`, `deviceId`, `deviceEpoch`, versiones, `mode`, `mechanism`, `status`, instantes, `reason?` | Solo destinatario y dispositivo principal; acuse idempotente por ocurrencia. |
| `withdrawAlarmRequest` | `reason` | Solo el creador; `expectedRequestVersion` vigente. |

Reglas que el validador ya impone:

- Aceptar exige `consentScope` (`THIS_OCCURRENCE` o `SERIES`). Rechazar o desactivar no admiten hora propia ni ámbito.
- `ALARM` solo se programa con `ALARM_RUNTIME`; `NOTIFICATION`, con `EXPO_NOTIFICATIONS`. Una ocurrencia nunca usa ambos.
- `FAILED` y `PENDING_PERMISSION` exigen motivo.
- Los destinatarios no se repiten y un aviso tiene como máximo seis.
- `timeSpec.effectiveAtEpochMs` debe ser exactamente el instante de `localDate` + `localTime` en `timeZone`.
- Cada registro de destinatario nace con `decisionRevision = 1`; la primera respuesta envía `expectedDecisionRevision: 1` y el servidor guarda `2`. Toda respuesta incrementa la revisión y nunca se retrocede.

## 3. Estados por eje

No hay un `active: boolean`. Una propuesta puede estar `ACTIVE` y una decisión `ACCEPTED` sin que exista programación local.

| Eje | Valores |
|---|---|
| Propuesta | `ACTIVE`, `WITHDRAWN`, `EXPIRED` |
| Recepción | `NOT_ACKNOWLEDGED`, `RECEIVED` (+ `receivedVersion`) |
| Decisión | `PENDING`, `ACCEPTED`, `REJECTED`, `DISABLED`, `NEEDS_REVIEW` |
| Programación | `NOT_SCHEDULED`, `PENDING_PERMISSION`, `SCHEDULING`, `SCHEDULED`, `CANCEL_PENDING`, `CANCELLED`, `FIRED`, `FAILED`, `EXPIRED` |
| Sincronización | `QUEUED`, `SENDING`, `CONFIRMED`, `CONFLICT`, `FAILED_PERMANENT` |

Reglas puras ya implementadas en `src/domain/`:

- `hasCurrentConsent({ decision, acceptedRequestVersion, requestVersion })`: aceptado solo vale para la versión vigente.
- `decisionAfterVersionBump(...)`: una versión nueva deja la decisión en `NEEDS_REVIEW` hasta que el destinatario vuelva a aceptar.
- `assertCanRespond(...)`: creador, terceros y miembros inactivos reciben `FORBIDDEN`; versiones obsoletas, `VERSION_CONFLICT`; propuesta retirada/caducada, `EXPIRED`.
- `summarizeScheduling(...)`: la UI solo muestra «programada» con `SCHEDULED`, `FIRED` o `CANCEL_PENDING`.

`ALARM` aceptado sin permiso es `PENDING_PERMISSION`, nunca `SCHEDULED`. Detener o posponer no cambia el vencimiento ni el responsable de una tarea.

## 4. Tiempo, recurrencia y cambio horario

Decisión cerrada en [ADR-003](adr/003-politica-dst.md):

- Instantes UTC en milisegundos enteros; zona IANA; se conserva también la hora civil propuesta.
- **Hora inexistente** (salto de primavera): se desplaza hacia delante la duración del salto.
- **Hora repetida** (salto de otoño): se usa la primera ocurrencia (instante UTC menor).
- La serie semanal se liga a la zona del grupo y recalcula la hora civil en cada fecha: viajar no cambia su hora de origen.
- Una ocurrencia perdida se marca vencida y se calcula la siguiente; no suena en diferido.

Utilidades listas en `src/domain/time.ts`: `createTimeSpec`, `wallClockToEpochMs`, `assertTimeSpecConsistent`, `nextWeeklyOccurrence`, `nextWeeklyOccurrences`, `formatDateTimeInZone`.

## 5. Identidad de ocurrencia

`src/domain/ids.ts`:

- `occurrenceIdFromEpochMs(effectiveAtEpochMs)` → `occ-<epochMs>`, determinista: reintentar no crea otra ocurrencia.
- `occurrenceKey({ userId, requestId, occurrenceId, deviceId, deviceEpoch })` → clave del store nativo/outbox.
- La misma forma que `OccurrenceKey` en `src/platform/alarms/index.ts` (frontera P4). Un cambio en uno exige cambiar el otro.

## 6. Errores

`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_ARGUMENT`, `VERSION_CONFLICT`, `EXPIRED`, `DEVICE_NOT_PRIMARY`, `RATE_LIMITED`, `TEMPORARY_UNAVAILABLE`.

- Solo `RATE_LIMITED` y `TEMPORARY_UNAVAILABLE` se reintentan (con backoff y jitter).
- No revelar la existencia de entidades ajenas: `NOT_FOUND` también cubre el acceso fuera de ámbito.
- `DomainError` (`src/domain/errors.ts`) es el tipo único en la app; `toDomainError` evita filtrar detalles privados.

## 7. Cómo trabajar con esto

```ts
import { parseRespondToAlarm, type RespondToAlarm } from '../domain/index.ts';

const command: RespondToAlarm = parseRespondToAlarm(input, { nowEpochMs: clock.nowEpochMs() });
const receipt = await repository.submit(command);
```

- Los componentes no hacen SQL ni HTTP ni llaman al runtime: usan `AlarmRepository` (`src/domain/ports.ts`).
- En tests y en la UI sin backend: `createInMemoryAlarmRepository`, `createFakeClock`, `createFakeAlarmRuntime` (`src/domain/fakes.ts`).
- La composición de dependencias está en `src/composition/index.ts`; el runtime y las notificaciones arrancan en su adaptador de indisponibilidad.

## 8. Fuera de esta versión

Rotaciones e intercambios, gastos, presupuestos, huchas y salida estructurada del agente. El contrato del agente (`proposeAlarm`) mantiene su forma `draft`/`needs_clarification` en el scaffold heredado `functions/src/agents/`; P3 lo llevará a `server/src/agents/` sin atribuirle permiso para aceptar alarmas. Su payload se cerrará con P3 y P2 antes de conectarlo.

## 9. Transporte HTTPS y almacenamiento objetivo

La v1 conserva `operationId`, `groupId`, `entityId`, versiones, payloads, enums y `OperationReceipt`/`AppError`. El cambio de Firebase a VPS no renombra campos ni convierte nombres de tabla SQL en rutas de dominio. Los títulos de algunos JSON Schema siguen describiendo rutas históricas; se interpretan como DTO, no como instrucciones para consultar Firestore. Los esquemas y fixtures existentes no cambian de forma; los wrappers de transporte se añaden como documentos nuevos.

- `POST /v1/operations/{operationName}` recibe el sobre v1 y devuelve directamente un `OperationReceipt`; en fallo, `AppError`, sin añadir campos que rompan `additionalProperties: false`.
- `POST /v1/auth/register`, `/v1/auth/login`, `/v1/auth/logout` y `GET /v1/auth/me` cubren sesión propia. Bearer opaco en cabecera, hash y expiración en servidor, token en SecureStore. No enviar token en URL.
- `GET /v1/groups/{groupId}/alarm-requests` y `/{requestId}` sobre esa ruta ofrecen lista paginada y detalle, filtrados por creador/destinatario y membresía activa. Los IDs adicionales van en un wrapper HTTP; `request`, `recipient` y `schedule` conservan sus esquemas. P1/P3 deben cerrar fixtures de esos wrappers antes de conectar consumidores.
- `GET /v1/sync?cursor=<opaco>` entrega páginas autorizadas. Cursor ligado al actor/ámbito; base/cursor se actualizan juntos en SQLite local. Incluir revocaciones mínimas para retirar datos locales cuando el usuario pierde acceso, sin exponer contenido del grupo.
- SSE opcional: `GET /v1/events?cursor=<opaco>` con bearer en cabecera; señal para consultar el feed. Polling acotado en primer plano y recuperación al abrir/reanudar son la base. Sin app activa no se garantiza recepción inmediata; push es una mejora opcional.

HTTP `400/401/403/404/409/429/503` expresa transporte y conserva códigos de aplicación v1; ver [mapeo del TDD](TDD.md#transporte-http-objetivo). Un timeout después del envío conserva `operationId` al reintentar. Un error no JSON del proxy se normaliza en el adaptador. No devolver SQL, stacks ni secretos como `details`.

SQLite del servidor es la autoridad compartida; `expo-sqlite` guarda proyección/outbox móvil; el store nativo gobierna programación/cancelación local. No comparten archivos ni una transacción distribuida. El servidor confirma estado, recibo idempotente y evento de cambio en una transacción corta. La red y el modelo quedan fuera de ella.

### Mapeo HTTP → código v1 (`src/domain/http.ts`)

| HTTP | Código por defecto | Acción del cliente |
|---|---|---|
| 400 | `INVALID_ARGUMENT` | Corregir; no reintentar igual. |
| 401 | `UNAUTHENTICATED` | Pausar la outbox de esa cuenta y pedir acceso. |
| 403 | `FORBIDDEN` | No reintentar; mostrar el límite. |
| 404 | `NOT_FOUND` | Tratar como no visible; no revelar existencia. |
| 409 | `VERSION_CONFLICT` (o `EXPIRED` en el cuerpo) | Reconciliar y recargar antes de reintentar. |
| 429 | `RATE_LIMITED` | Respetar `Retry-After` y backoff con jitter. |
| 500 / 503 | `TEMPORARY_UNAVAILABLE` | Conservar la operación y reintentar acotado. |

El cuerpo `AppError` manda cuando trae un `code` v1; un proxy sin JSON se normaliza sin filtrar HTML ni trazas. Solo `RATE_LIMITED` y `TEMPORARY_UNAVAILABLE` se reintentan. Un timeout tras enviar conserva el mismo `operationId`.

### Fixtures y validadores de transporte

| Contrato | Esquema | Fixture | Validador |
|---|---|---|---|
| Registro/login | `session.schema.json#/$defs/authResponse` | `documents/auth-response.json` | `parseAuthResponse` |
| Sesión vigente | `session.schema.json#/$defs/meResponse` | `documents/auth-me.json` | `parseMeResponse` |
| Feed por cursor | `sync-page.schema.json` | `documents/sync-page.json` | `parseSyncPage` |
| Lista de propuestas | `alarm-request-page.schema.json` | `documents/alarm-request-page.json` | `parseAlarmRequestPage` |
| Detalle de propuesta | `alarm-request-detail.schema.json` | `documents/alarm-request-detail.json` | `parseAlarmRequestDetail` |

`nextCursor: null` termina el feed conocido. El cursor no concede acceso: el servidor lo liga a actor y ámbito. El token de sesión es un secreto opaco (≥ 32 caracteres) y no debe registrarse ni guardarse fuera de SecureStore.

### Configuración del cliente

- `EXPO_PUBLIC_API_URL` (ver `.env.example`) debe ser `https://…`; solo `localhost`, `127.0.0.1` y `10.0.2.2` aceptan `http` con `allowLocalHttp` en desarrollo.
- `readApiBaseUrl` rechaza URL sin esquema, credenciales embebidas, query o fragmento, y falla si la variable no existe en vez de inventar un host.
- Ninguna credencial del servidor (SQLite, tokens, claves push) va en la app ni en el bundle.

## 10. Divergencias actuales con el scaffold

**Esta revisión cambia documentación, no ejecuta la migración.** Estado de referencia A01: P3/P5 deben implementar y probar la arquitectura nueva antes de declarar disponibilidad.

| Pieza | Situación | Qué hacer |
|---|---|---|
| `functions/src/contracts/operation.ts` | Validador heredado: acepta un subconjunto del sobre; no tiene idempotencia real. | P3 usa contratos compartidos en `server/src/contracts/`; no mantener validadores divergentes. |
| `functions/src/operations/alarms.ts` | Callables heredadas verifican Auth/sobre y devuelven `unimplemented`. | P3 crea handlers HTTP en `server/src/operations/` con transacciones SQLite, sesión, autorización y deduplicación. No devolver éxito mientras sea scaffold. |
| `functions/`, `firebase/`, dependencias/scripts existentes | Infraestructura Firebase heredada todavía en repositorio. | P1/P3 retiran o sustituyen dependencias, CI y configuración en el cambio de implementación; compilarlas no valida el nuevo servidor. |
| `src/domain/alarms.ts` (`AlarmSummary`) | Proyección de UI; no incluye versiones ni dispositivo. | No usarla como contrato de seguridad ni como estado de servidor. |
| `src/data/alarmRepository.ts` (`demoAlarm`) | Repository en memoria; aceptar solo cambia la proyección. | P5 lo sustituye por `expo-sqlite` + API HTTPS mediante `fetch`, siguiendo `AlarmRepository`; sesión coordinada con P2. |
| `app.config.ts` | Configuración de aplicación, sin un backend VPS operativo. | P1/P2/P5 configuran URL pública HTTPS y SecureStore; jamás credenciales SQLite en el móvil. Credenciales FCM solo si se activa push Android opcional. |
| `modules/alarm-runtime` | Implementa store nativo, AlarmManager, sonido, detener/posponer y recuperación; las tareas de `src/features/tasks` programan avisos. | P4 mantiene `OccurrenceKey` según `src/domain/ids.ts`; el runtime no depende de Firebase ni del VPS para sonar. |

