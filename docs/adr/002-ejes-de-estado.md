# ADR-002 · Ejes de estado separados y versiones

**Fecha:** 2026-10-22 · **Owner:** P1 (revisión P3/P4) · **Estado:** aceptado

## Contexto

El scaffold usaba `decision: 'pending' | 'accepted' | 'rejected'` y un `scheduling` de tres valores para la bandeja. Ese resumen es útil para la UI, pero no distingue recepción, consentimiento, programación local y sincronización. Si se usa como estado de dominio, la app puede mostrar «programada» una alarma que solo fue aceptada, o perder la cancelación pendiente de un móvil sin red.

## Decisión

`src/domain/states.ts` define cinco ejes independientes y sin enum único:

| Eje | Valores |
|---|---|
| Propuesta | `ACTIVE`, `WITHDRAWN`, `EXPIRED` |
| Recepción | `NOT_ACKNOWLEDGED`, `RECEIVED` |
| Decisión | `PENDING`, `ACCEPTED`, `REJECTED`, `DISABLED`, `NEEDS_REVIEW` |
| Programación | `NOT_SCHEDULED`, `PENDING_PERMISSION`, `SCHEDULING`, `SCHEDULED`, `CANCEL_PENDING`, `CANCELLED`, `FIRED`, `FAILED`, `EXPIRED` |
| Sincronización | `QUEUED`, `SENDING`, `CONFIRMED`, `CONFLICT`, `FAILED_PERMANENT` |

Reglas asociadas:

- `requestVersion` sube al cambiar título, destinatarios, horario, modalidad o recurrencia.
- `decisionRevision` sube con cada respuesta del destinatario y nunca retrocede.
- Un consentimiento vale solo para `(requestVersion, decisionRevision)`; un cambio de términos deja la decisión en `NEEDS_REVIEW`.
- `scheduleReport` identifica `(requestVersion, decisionRevision, occurrenceId, deviceId, deviceEpoch)`.
- `AlarmSummary` (`src/domain/alarms.ts`) sigue siendo una proyección pequeña para la UI; se obtiene con `decisionToSummary` y `schedulingToSummary`.

## Consecuencias

- P2 muestra estados explícitos y no inventa un booleano «activa».
- P5 proyecta los ejes en SQLite y conserva tombstones de cancelación.
- P3 rechaza acuses de versiones o `deviceEpoch` anteriores.
- Añadir un estado requiere actualizar `states.ts`, `contracts/schemas/common.schema.json`, los fixtures y este documento en el mismo cambio. Cambiar el significado de uno existente exige versión nueva del contrato.

## Persistencia tras el cambio a VPS

Los ejes y versiones no cambian con el backend: SQLite del VPS conserva propuesta/decisión confirmadas; `expo-sqlite` conserva la proyección/outbox de P5; el store nativo de P4 conserva programación y tombstones. La API obtiene el actor de su sesión verificada. P3 acepta acuses solo para la pareja vigente de versiones y `deviceEpoch`, dentro de una transacción; no se presume atomicidad con el móvil.
