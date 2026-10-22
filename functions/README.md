# Firebase y agente · P3

Punto de partida, sin persistencia ni despliegue. Las cuatro callables comprueban autenticación y el sobre básico y terminan con `unimplemented`; no crean propuestas ni programan alarmas. Firestore deniega todo mientras se escriben y prueban sus reglas.

Desde la raíz del repositorio, con Node 22 (también utilizado por Expo) y Java compatible con los emuladores:

```sh
npm --prefix functions ci
npm --prefix functions run typecheck
npm --prefix functions run build
npx firebase-tools@15.34.1 emulators:start --project demo-alarmat --only auth,firestore,functions
```

El ID `demo-alarmat` es local y ficticio; no se necesitan credenciales para esta configuración. Queda pendiente seleccionar un proyecto real y completar la autorización. Versiones fijadas: Firebase Admin 14.5.0, Firebase Functions 7.4.0 y TypeScript 5.9.3.

Verificado con Node 22: compilación, TypeScript y smoke de autenticación/sobre/stub para las cuatro callables. La instalación del lockfile informa cero vulnerabilidades conocidas. Los emuladores aún no se han ejecutado.

## Primeros tickets

1. **P3 / B01:** Auth, miembros e invitaciones. Pruebas de reglas: miembro permitido, tercero denegado, tokens privados. Admin SDK requiere autorización propia en Functions.
2. **P3 + P1 / B02:** concretar contratos de `createAlarmRequest`, `respondToAlarm` y `reportSchedule`; validar payload, versiones y dispositivo principal. Implementar transacciones e idempotencia antes de devolver éxito.
3. **P3 + P5:** evento persistido → FCM con IDs/versiones → recuperar estado. Reintentos no duplican operaciones y un push no programa una alarma.
4. **P3 + P2 / agente:** conectar planner a `proposeAlarm`, contexto mínimo autorizado y salida `draft` o `needs_clarification`; esquema validado, límites de tiempo/coste y revisión del emisor antes de crear la propuesta. El receptor conserva la decisión final.
5. **P3 + P6 / automatizaciones:** recurrencia y tareas completadas producen eventos versionados; reconciliar cancelaciones y evitar reactivar avisos. Una regla nueva o cambio de horario requiere el consentimiento aplicable.

Casos esenciales al implementar: usuario ajeno, payload mal formado, versión vieja, operación repetida, mismo ID con payload diferente, propuesta caducada y fallo del modelo. No interpretar `hasCurrentConsent` como autorización completa: es solo una regla pura inicial.

Contratos completos y reparto: [TDD](../docs/TDD.md), [equipo](../docs/TEAM_PLAN.md).
