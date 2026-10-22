# P5 · Datos y sincronización

`alarmRepository.ts` ofrece una bandeja **en memoria** para desarrollar UI. Aceptar solo cambia a `pending_activation`: no confirma servidor, entrega ni alarma local. Reiniciar pierde todo. No contiene conexión a la API del VPS.

Puntos de entrada:

- `createDemoAlarmRepository`: `list`, `subscribeInbox`, `respond` para el prototipo.
- `../platform/sync/outbox.ts`: puerto mínimo de comandos pendientes, sin adaptador.
- `../bootstrap/index.ts`: inicialización explícitamente vacía; no registra todavía sincronización remota ni listeners push.

Primeras entregas: migración SQLite + outbox durable; adaptar comandos a los contratos versionados de P3; implementar HTTP, sesión en SecureStore y recuperación de cambios por cursor; reconciliar con snapshot nativo de P4; actualizar proyección y widget. No abrir ni replicar el archivo SQLite del VPS desde el móvil ni mantener dos colas offline. Las firmas de demo son un corte reducido del [TDD](../../docs/TDD.md), no el contrato de producción.

Desde la raíz: `npm run typecheck`. Antes de sustituir el demo, verificar reinicio, reintentos idempotentes y rechazo sin programación. API/HTTPS, permisos y dispositivos se configuran con P1/P3/P4; este scaffold no acredita esas pruebas.
