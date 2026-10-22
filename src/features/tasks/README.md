# P6 · Tareas vinculadas

Estado: modelo, puertos, UI y ruta `/task/[taskId]` en código. Repositorio real (P5) y
operaciones (P3) pendientes; la demo usa un fake en memoria y lo etiqueta.

## Modelo (`model.ts`)

- `HouseholdTask`: `id`, `groupId`, `title`, `assigneeUid` (**UID**, nunca nombre libre),
  `activateAtEpochMs`/`dueAtEpochMs` opcionales, `status`, `version`,
  `completedByUid`/`completedAtEpochMs`.
- `validateTaskDraft` exige título 1–120, responsable miembro **activo** y
  vencimiento ≥ activación.
- `completeTask`/`cancelTask` son idempotentes: repetir no sube versión ni vuelve a
  invalidar alarmas. Completar una cancelada (y viceversa) es un error explícito.
- `taskAfterAlarmInteraction` devuelve la misma tarea: detener o posponer una alarma
  **no** completa nada (invariante 6 del TDD).
- `planLinkedAlarmWithdrawal` produce el plan que P3 ejecuta en servidor
  (`withdrawLinkedAlarms`, `requestIds` únicos). La UI no escribe Firestore.
- `describeTaskCardState` traduce `SyncStatus` + retirada pendiente; nunca afirma
  «completada» sin confirmación.

## Puertos (`ports.ts`)

`TaskRepository.subscribeTasks(groupId, onChange)` y
`submit(CreateTaskCommand | CompleteTaskCommand | CancelTaskCommand)` con
`operationId` + `expectedVersion`. P3 debe crear los esquemas equivalentes; el sobre es
el mismo de las alarmas (`OperationReceipt`).

## UI

- `TaskCard.tsx`: nota Nevera Retro con estado, responsable por inicial, vencimiento y
  versión.
- `TaskList.tsx`: lista y estado vacío explícito.
- `TaskDetail.tsx`: hoja grande con acciones; muestra conflicto, escritura pendiente y
  retirada de alarmas sin acuse.
- `TaskPreview.tsx`: tablero de demostración con fake en memoria, etiquetado `demo`.
- `app/task/[taskId].tsx` (P6, ruta fina): valida el parámetro y comprueba acceso con
  `resolveTaskAccess`. **Abrir el enlace no completa ni acepta nada.**

## Pendiente de otras áreas

| Necesidad | Owner |
|---|---|
| Sesión real (`DEMO_SESSION` es solo demo) | P2 |
| Repositorio SQLite/outbox y publicación del snapshot | P5 |
| `createTask`/`completeTask`/`cancelTask` con autorización e idempotencia | P3 |
| Cancelación local de alarmas vinculadas al reconciliar | P4/P5 |
| Resolver nombres de miembros (UID → nombre visible) | P2 |

Contratos de prueba: `tests/tasks.test.ts`.
