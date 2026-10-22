# ADR-004 · Snapshot del widget v2 y enlaces

**Fecha:** 22 de octubre de 2026 · **Owner:** P6 · **Revisa:** P5
**Estado:** aceptado para el primer corte; sujeto a la prueba en dispositivo.

## Contexto

La base tenía `buildWidgetSnapshot(alarms, now)` con tres datos planos:
`pendingProposals`, `pendingActivation` y una próxima alarma con `AlarmSummary`. Ese
resumen no permite distinguir usuario/grupo, frescura, retirada pendiente ni la
identidad de la ocurrencia. A la vez, `docs/ROUTES.md` exige que el widget abra rutas
sin aceptar nada.

`expo-widgets` ejecuta la plantilla en un runtime aislado: sin hooks, sin acceso a
`Intl`, sin SQLite ni Firebase, y en Android sin acción nativa para abrir la app.

## Decisión

1. **Un único contrato versionado** (`WIDGET_SNAPSHOT_SCHEMA_VERSION = 2`) con
   `scope: { userId, groupId } | null`, `generatedAtEpochMs`, `nextAlarm` y tres
   contadores separados (`pendingProposals`, `pendingActivations`, `withdrawalPending`).
2. **Selección pura**: solo `ACTIVE` + `ACCEPTED` + `SCHEDULED` + instante futuro.
   Orden por hora, luego `requestId`, luego `occurrenceId`; reloj inyectado.
3. **Frescura explícita**: 30 min por defecto; el widget se marca «sin conexión» y no
   interpreta el paso del tiempo por su cuenta.
4. **Sesión acotada**: al cambiar de usuario/grupo o cerrar sesión se publica el
   snapshot vacío. Un snapshot viejo no se pinta para otra cuenta.
5. **Props precalculadas** (`toWidgetProps`) para que la plantilla solo pinte cadenas:
   nombres de día, hora y enlaces se resuelven en la app con zona explícita.
6. **Enlaces de solo apertura**: `alarmat://alarm/<id>`, `alarmat://task/<id>`,
   `alarmat:///`. Sin query ni fragmento; IDs validados. Abrir nunca decide.
7. **Widget informativo en Android**: sin botones mientras la librería no pueda abrir
   la app. El enlace se conserva en props para la acción nativa/notificación.

## Alternativas descartadas

- Reutilizar `AlarmSummary` (pierde `SCHEDULING`/`FAILED`/`CANCEL_PENDING`).
- Formatear fechas dentro del widget (runtime aislado, sin `Intl` fiable).
- Añadir un botón con `onPress` que solo reevalúa props: parece navegar y no lo hace.
- Guardar el snapshot completo de alarmas en el widget: expone datos que el launcher no
  necesita y crece sin límite.

## Consecuencias

- P5 debe emitir el snapshot tras reconciliar/decidir y limpiarlo al cerrar sesión.
- P3 debe crear operaciones de tarea con versiones e idempotencia (handoff).
- La aceptación «widget con deep link» queda **parcialmente bloqueada** hasta que
  P1/P4 habiliten la acción nativa; se entrega widget instalable + contrato de enlaces y
  se documenta el límite en `docs/demo.md`.
- Cambiar la forma del snapshot exige subir `WIDGET_SNAPSHOT_SCHEMA_VERSION` y actualizar
  consumidores en el mismo cambio.
