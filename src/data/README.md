# P5 · Datos y sincronización

`alarmRepository.ts` ofrece una bandeja **en memoria** para desarrollar UI. Aceptar solo cambia a `pending_activation`: no confirma servidor, entrega ni alarma local. Reiniciar pierde todo. No contiene conexión Firebase.

Puntos de entrada:

- `createDemoAlarmRepository`: `list`, `subscribeInbox`, `respond` para el prototipo.
- `../platform/sync/outbox.ts`: puerto mínimo de comandos pendientes, sin adaptador.
- `../bootstrap/index.ts`: inicialización explícitamente vacía; no registra FCM.

Primeras entregas: migración SQLite + outbox durable; adaptar comandos a los contratos versionados de P3; conectar listeners de RNFirebase; reconciliar con snapshot nativo de P4; actualizar proyección y widget. No escribir directamente mutaciones de dominio en Firestore ni mantener dos colas offline. Las firmas de demo son un corte reducido del [TDD](../../docs/TDD.md), no el contrato de producción.

Desde la raíz: `npm run typecheck`. Antes de sustituir el demo, verificar reinicio, reintentos idempotentes y rechazo sin programación. Firebase, permisos y dispositivos se configuran con P1/P3/P4; este scaffold no acredita esas pruebas.
