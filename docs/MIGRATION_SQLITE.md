# Cambio a SQLite en VPS — 22 de octubre de 2026

## Alcance de esta entrega

Se actualizan los prompts de las seis personas y las especificaciones. La implementación del servidor, la migración de dependencias y el despliegue siguen pendientes. `functions/` y `firebase/` conservan código/configuración heredados; `server/` es el destino a crear por P3. No se han cambiado los DTO, JSON Schema, fixtures ni código de la app en esta entrega documental.

## Decisiones sustituidas

| Antes | Arquitectura objetivo |
|---|---|
| Firebase Auth | Usuarios propios, contraseñas Argon2id y sesiones opacas revocables; token móvil en SecureStore. |
| Firestore | SQLite privado en disco persistente del VPS, mediante better-sqlite3 y migraciones SQL. |
| Cloud Functions/callables | API HTTPS Node 22 + TypeScript + Fastify en `server/`. |
| RNFirebase/listeners | Cliente HTTP de P5, feed incremental con cursor, recuperación al abrir/reanudar y polling en primer plano. SSE opcional. |
| Reglas de Firestore | Autorización por sesión/recurso en servidor, transacciones, restricciones SQL y pruebas de acceso. |
| Envío desde Firebase Admin | Outbox del servidor y Expo Push Service opcional; Android sigue requiriendo FCM como transporte. |

SQLite en el VPS, SQLite local del móvil y el registro del runtime nativo son almacenes distintos. El teléfono no abre el archivo del servidor y elegir SQLite no proporciona sincronización automática. Sin push no se promete entrega remota inmediata con la app cerrada; las alarmas ya consentidas y programadas se ejecutan localmente.

## Cambio por persona

| Persona | Prompt y cambio concreto |
|---|---|
| P1 · Base y contratos | [Prompt](prompts/01_BASE_CONTRACTS.md): configuración de API, dependencias compatibles, contratos HTTP y futura CI de servidor con P3; no instalar RNFirebase. |
| P2 · Pantallas | [Prompt](prompts/02_SCREENS.md): sesión y formularios consumen puertos de P5; no acceden directamente a SQLite remoto ni a SDK Firebase. |
| P3 · SQLite, VPS y agente | [Prompt nuevo](prompts/03_SQLITE_VPS_AGENT.md): API, sesiones, SQL, permisos, transacciones, idempotencia, feed/outbox, pruebas y despliegue pendiente. [Subprompt IA](prompts/03A_AGENT_SUBAGENT.md): contexto autorizado mediante servicios del servidor. |
| P4 · Alarmas Android | [Prompt](prompts/04_ANDROID_ALARMS.md): consentimiento confirmado por API; runtime autónomo y registro local, sin depender de red al sonar. |
| P5 · Datos y sincronización | [Prompt](prompts/05_DATA_SYNC.md): SQLite local/outbox, HTTP autenticado, SecureStore, cursores, reconciliación y push opcional. |
| P6 · Widget, tareas e integración | [Prompt](prompts/06_WIDGETS_TASKS_INTEGRATION.md): snapshots de P5, tareas mediante operaciones autorizadas y prueba entre dos móviles contra la API. |

El consentimiento, las versiones, la idempotencia, la separación de estados y las prioridades del producto se conservan. P3 mantiene la responsabilidad del agente; P6 mantiene integración/demo.

## Documentos actualizados

- Nuevos: este registro, [guía SQLite/VPS](SQLITE_VPS_PRACTICES.md), [ADR 004](adr/004-vps-sqlite.md) y el nuevo prompt P3.
- Visión y organización: `README.md`, `FEATURES.md`, `CONTRIBUTING.md`, `docs/START_HERE.md`, `docs/TEAM_PLAN.md` y `docs/ROUTES.md`.
- Especificaciones: `docs/TDD.md`, `docs/CONTRACTS.md`, `contracts/README.md`, `docs/ANDROID_PRACTICES.md` y `docs/STATE_OF_THE_ART.md`.
- Prompts: índice, P1, P2, P4, P5, P6 y subprompt IA de P3; el antiguo `03_FIREBASE_AGENT.md` remite al nuevo.
- Historia: ADR 001 y 002 aclaran la decisión vigente; `docs/FIREBASE_PRACTICES.md` conserva un enlace a la guía sustituta.
- Puntos de entrada: `functions/README.md`, `modules/alarm-runtime/README.md`, `src/data/README.md`, `src/features/auth/README.md` y `src/features/groups/README.md`.

## Implementación pendiente

1. P1/P3 fijan fixtures de sesión, consultas/feed y mapeo HTTP conservando sobres v1.
2. P3 crea `server/`, migraciones, sesiones, operaciones y pruebas contra SQLite real temporal; incluye aislamiento A/B/C y carreras idempotentes.
3. P5 conecta HTTP, SecureStore, SQLite local y runtime; P2/P6 sustituyen simulaciones por esos puertos.
4. P1/P3 actualizan dependencias, scripts y CI y retiran el legado tras verificar consumidores. Compilar `functions/` todavía solo comprueba el scaffold anterior.
5. P3 configura HTTPS, persistencia, secretos, supervisión y backups con restauración verificada cuando estén disponibles los datos del VPS. P4/P5/P6 prueban el recorrido en dos dispositivos.

No se presenta una migración documental como un backend operativo. Los enlaces a fuentes oficiales y los límites de cada decisión están en la guía SQLite/VPS.
