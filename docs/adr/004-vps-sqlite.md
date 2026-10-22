# ADR 004 — API propia y SQLite en el VPS

- Fecha: 22 de octubre de 2026.
- Estado: aceptada como arquitectura objetivo; migración de código pendiente.
- Motivo: el equipo dispone de VPS y solicita SQLite en todos los frentes.

## Decisión

Mantener Expo/React Native/TypeScript/Expo Router, widgets y runtime nativo Android. Sustituir Firebase Auth/Firestore/Cloud Functions/RNFirebase por API HTTPS en Node.js 22 + TypeScript + Fastify, SQLite (`better-sqlite3`) en disco local del VPS y migraciones SQL versionadas. Usar una instancia de aplicación, transacciones breves, WAL, foreign keys y timeout acotado. La base del móvil sigue siendo `expo-sqlite`, con sincronización explícita; jamás se comparte el archivo del VPS con los teléfonos.

Identidad propia con Argon2id y bearer opaco, hash del token, caducidad/revocación y SecureStore móvil. Conservar DTO, versiones e idempotencia al transportar operaciones por `POST /v1/operations/{operationName}`. Sincronización incremental autorizada por HTTPS y cursor opaco; SSE foreground opcional. Expo Push Service + `expo-notifications` opcional: su transporte Android sigue siendo FCM y necesita configuración Google, sin reintroducir Firebase como backend. Sin push no se garantiza entrega remota con la app cerrada; una alarma local ya aceptada/programada no depende de esa entrega.

## Consecuencias y trabajo

P3 implementa servidor, auth, migraciones, autorización por recurso, outbox, agente y operación del VPS. P5 implementa HTTP, sesiones, caché/outbox y reconciliación. P1 integra dependencias/configuración/contratos/CI; P2 conecta sesión y formularios; P4 conserva autoridad nativa de programación; P6 actualiza widget/tareas y pruebas de dos dispositivos. El equipo asume copias y restauración, HTTPS, sesiones y operación del proceso que antes delegaba al proveedor.

No se migra infraestructura desplegada en esta decisión documental. `functions/` y `firebase/` quedan identificados como legado y se retirarán al migrar implementación y CI. `server/` es la ubicación objetivo, todavía no prueba de servidor funcional. No se inventa URL ni credenciales del VPS. Cambiar a SQL no cambia consentimiento, privacidad de propuestas ni prioridad P1 de IA.

Referencias normativas: [TDD](../TDD.md), [prácticas SQLite/VPS y fuentes primarias](../SQLITE_VPS_PRACTICES.md), [P3](../prompts/03_SQLITE_VPS_AGENT.md). Esta ADR sustituye las decisiones de proveedor Firebase de documentos anteriores, conservando decisiones de Expo, estados y DST que no dependen del backend.
