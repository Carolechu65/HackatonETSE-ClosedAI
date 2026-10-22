# P6 · Handoff a otras áreas

Cambios que P6 necesita de zonas ajenas, con el parche mínimo. Nada de esto se
implementa aquí dentro para no duplicar responsabilidades.

## A P1 · configuración, dependencias y CI

Ya están aplicados en la rama `feat/p6-widget-tasks-demo`; **revisar/rebasear** antes de
mezclar porque toca `package.json`, `package-lock.json`, `app.config.ts` y
`tsconfig.tests.json`:

```diff
// package.json
+ "expo-widgets": "~58.0.22",
+ "@expo/ui": "~58.0.22",
- "test": "node --experimental-strip-types ... --test tests"
+ "test": "node --experimental-strip-types ... --test \"tests/**/*.test.ts\""
```

El cambio del script es necesario con Node 22.21: `--test tests` interpreta el
directorio como módulo. Verificado en local; CI usa `node-version-file: .nvmrc` (22).

```ts
// app.config.ts
plugins: [
  'expo-router',
  ['expo-widgets', {
    enableAndroid: true,
    widgets: [{
      name: 'AlarmaTWidget',
      displayName: 'AlarmaT',
      description: 'Próxima alarma, propuestas pendientes y estado de sincronización.',
      ios: { supportedFamilies: ['systemSmall', 'systemMedium'] },
      android: {
        targetCellWidth: 4,
        targetCellHeight: 2,
        resizeMode: 'horizontal',
        initialLayout: './src/widgets/AlarmaTWidget.tsx',
      },
    }],
  }],
]
```

También se añadieron `src/widgets/**/*.ts` y `src/features/tasks/**/*.ts` a
`tsconfig.tests.json` (excluyendo `publisher.ts` y los `.tsx`, que necesitan JSX/RN).

**Acción de P1:** `npx expo prebuild --platform android` y development build nueva.
El widget no existe hasta reconstruir el binario; Fast Refresh no lo instala.

## A P1/P4 · deep link desde el widget

`expo-widgets@58.0.22` no expone una acción que abra la app desde un widget Android:
`WidgetInteractionAction.kt` usa `actionSendBroadcast` y `evaluateWidgetButtonPress`;
los botones solo devuelven props nuevas. Se necesita una de estas dos vías:

1. **Acción nativa en el widget** (preferida): un `PendingIntent.getActivity` con
   `Intent.ACTION_VIEW` y `Uri.parse('alarmat://alarm/<id>')` sobre el contenedor del
   widget. Implica parchear/forzar el provider de `expo-widgets` o un config plugin
   propio; decisión de P1 con P4.
2. **Notificación** (disponible ya): usar `url` de `CustomNotificationOptions` para
   abrir el detalle. El contrato `links.ts` ya genera y valida la URL.

Hasta entonces el widget es informativo y la demo lo dice. No añadir un botón que no
navegue.

## A P5 · publicación del snapshot

- Construir `WidgetAlarmInput[]` desde la proyección reconciliada, con los ejes del TDD
  (no con el enum simplificado de `AlarmSummary`).
- Llamar a `syncWidgetForSession(snapshot, session, nowEpochMs, { timeZone })` tras:
  reconciliación al abrir/reanudar, decisión confirmada, acuse de programación/cancelación,
  cierre de sesión y cambio de cuenta.
- En logout: `clearWidget(nowEpochMs)` además de borrar SQLite. No reutilizar snapshots
  de otra cuenta (`adoptSnapshotForSession`).
- El widget no se refresca por FCM ni por un timer: no prometerlo en la UI.

## A P3 · operaciones de tarea

Propuesta de campos (mismo sobre `operationId` + versiones que las alarmas):

```ts
type TaskDraft = { title; assigneeUid: string | null; activateAtEpochMs: number | null; dueAtEpochMs: number | null };
type CreateTaskCommand = { kind:'createTask'; operationId; groupId; draft: TaskDraft };
type CompleteTaskCommand = { kind:'completeTask'; operationId; groupId; taskId; expectedVersion; completedAtEpochMs };
type CancelTaskCommand = { kind:'cancelTask'; operationId; groupId; taskId; expectedVersion; cancelledAtEpochMs };
```

Requisitos: miembro activo autorizado, `assigneeUid` de miembro activo, control de
versión, idempotencia por `operationId`, y al completar/cancelar invalidar alarmas
vinculadas en la misma transacción. Devolver `OperationReceipt`.
`planLinkedAlarmWithdrawal` ya calcula los `requestId` afectados en el cliente.

## A P2 · rutas y sesión

- Ruta acordada: `/task/[taskId]` (implementada por P6, ruta fina).
- Sustituir `DEMO_SESSION` por el hook de sesión real; sin sesión, pedir acceso antes de
  cargar la tarea. Una tarea de otro grupo debe terminar en `/+not-found`.
- Resolver UID → nombre visible; `TaskCard`/`TaskDetail` ya reciben `assigneeName`.
- El widget abre `/alarm/[requestId]` (no un formulario que acepte solo).
