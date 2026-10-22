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
- El servidor obtiene el actor de `request.auth.uid`. `actorUid` en el cuerpo se rechaza (`invalid/operation-envelope.client-actor-uid.json`).
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

- Los componentes no llaman a Firestore ni al runtime: usan `AlarmRepository` (`src/domain/ports.ts`).
- En tests y en la UI sin backend: `createInMemoryAlarmRepository`, `createFakeClock`, `createFakeAlarmRuntime` (`src/domain/fakes.ts`).
- La composición de dependencias está en `src/composition/index.ts`; el runtime y las notificaciones arrancan en su adaptador de indisponibilidad.

## 8. Fuera de esta versión

Rotaciones e intercambios, gastos, presupuestos, huchas y salida estructurada del agente. El contrato del agente (`proposeAlarm`) mantiene su forma `draft`/`needs_clarification` en `functions/src/agents/`; su payload se cerrará con P3 y P2 antes de conectarlo.

## 9. Divergencias actuales con el scaffold

Estado real al cerrar A01; P3 las resuelve en B02:

| Pieza | Situación | Qué hacer |
|---|---|---|
| `functions/src/contracts/operation.ts` | Acepta `schemaVersion`, `operationId`, `groupId` y `payload`, pero no `entityId` ni versiones esperadas; no hay idempotencia real. | Adoptar `parseOperationEnvelope` de `src/domain` (o generar el validador desde los esquemas) antes de implementar transacciones. |
| `functions/src/operations/alarms.ts` | Las tres callables comprueban Auth y el sobre, y devuelven `unimplemented`. | Implementar con transacciones, autorización y deduplicación del `operationId`. |
| `src/domain/alarms.ts` (`AlarmSummary`) | Proyección de UI del scaffold; no incluye versiones ni dispositivo. | No usarla como contrato de seguridad ni como estado de servidor. |
| `src/data/alarmRepository.ts` (`demoAlarm`) | Repository en memoria; aceptar solo cambia la proyección. | P5 lo sustituye por SQLite + RNFirebase sobre `AlarmRepository`. |
| `app.config.ts` | `android.package` fijado; no hay `googleServicesFile` ni plugins nativos de Firebase. | P3/P5 añaden la configuración del proyecto real fuera de Git (`google-services.json` está ignorado). |
| `modules/alarm-runtime` | Declara capacidades no disponibles y rechaza programar. | P4 implementa; `OccurrenceKey` debe seguir la forma de `src/domain/ids.ts`. |

