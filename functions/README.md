# Backend anterior: stubs Firebase pendientes de migración

**Esta carpeta es legado, no el backend elegido.** La arquitectura objetivo es Node.js 22 + TypeScript + Fastify + SQLite en el VPS, implementada en `server/`. Consulta [P3](../docs/prompts/03_SQLITE_VPS_AGENT.md), [prácticas SQLite/VPS](../docs/SQLITE_VPS_PRACTICES.md) y [ADR 004](../docs/adr/004-vps-sqlite.md).

La actualización documental no migra este código ni sus dependencias. Las callables actuales siguen siendo stubs que validan parte de la entrada y terminan con `unimplemented`; no son una API SQL operativa. No despliegues esta carpeta como solución vigente ni añadas nuevas funciones Firebase.

P3 debe reutilizar las reglas puras y contratos válidos, implementar autorización propia, operaciones HTTP, transacciones SQL, idempotencia y agente en `server/src/`. P1 coordina scripts, dependencias y CI; P5 sustituye los adaptadores cliente por HTTPS y sincronización incremental. Retirar `functions/`, `firebase/` y dependencias antiguas será una entrega de implementación separada, tras adaptar CI y verificar que nadie las consume.

Mientras continúen existiendo, sus comprobaciones históricas solo verifican el código anterior:

```sh
npm --prefix functions ci
npm --prefix functions run typecheck
npm --prefix functions run build
```

La prueba de aceptación del nuevo backend será A crea → B consulta y responde → C recibe denegación, sobre SQLite real, con pruebas de concurrencia e idempotencia. El transporte push opcional será Expo Push Service; FCM solo es su transporte Android y no una dependencia del almacenamiento o identidad.
