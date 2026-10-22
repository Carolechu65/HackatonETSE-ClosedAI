# SQLite y VPS para alarmaT

**Decisión de diseño: 22 de octubre de 2026. Implementación pendiente.** Sustituye Firebase Auth, Firestore, Cloud Functions y RNFirebase. Las referencias primarias se han consultado para esta revisión; no constituye una comparativa de rendimiento ni una certificación de «SOTA». [TDD](TDD.md), [ADR 004](adr/004-vps-sqlite.md) y [prompt P3](prompts/03_SQLITE_VPS_AGENT.md) concretan el trabajo.

## 1. Stack y fronteras

| Pieza | Decisión |
|---|---|
| Servidor | Node.js 22 + TypeScript estricto + Fastify, un proceso de aplicación en el VPS. |
| Base compartida | SQLite con `better-sqlite3`, archivo privado en disco persistente local del VPS. |
| Migraciones | SQL numerado y versionado en `server/migrations/`, tabla de versiones y ejecución exclusiva antes de arrancar. |
| Identidad | Usuarios propios, contraseñas Argon2id y sesiones bearer opacas aleatorias, con hash del token en servidor. |
| Cliente | Expo + React Native + TypeScript + Expo Router; HTTPS mediante adaptadores de P5. |
| Persistencia móvil | `expo-sqlite`: proyección local y outbox; `expo-secure-store`: token de sesión. |
| Actualizaciones | Consulta incremental autenticada; SSE opcional mientras la app está activa. |
| Aviso remoto opcional | Expo Push Service + `expo-notifications`; FCM solo como transporte Android. |
| Alarmas | Runtime Kotlin de P4; programación local consentida, independiente del servidor a la hora de sonar. |

**Las bases SQLite del VPS y de cada móvil son diferentes.** No se comparte el archivo, no se replica mediante copiarlo y no hay sincronización automática por elegir SQLite. Los móviles solo hablan con la API, nunca ejecutan SQL remoto. La autorización reside en servicios del servidor, no en el motor SQL ni en IDs enviados por el cliente.

`server/` es la ubicación objetivo. Los stubs existentes en `functions/`, `firebase/` y los manifests asociados permanecen como legado hasta que P3/P1 migren código y CI. Esta revisión documental no instala paquetes ni proporciona un servidor desplegado. Fastify publica su [política de compatibilidad LTS](https://fastify.dev/docs/latest/Reference/LTS/); al implementar se fijan versiones compatibles con Node 22 en el lockfile y se prueba el addon nativo `better-sqlite3` en la arquitectura real del VPS.

## 2. Persistencia y esquema

Inicializar cada conexión con `foreign_keys = ON` y un `busy_timeout` acotado —punto de partida: 5000 ms—, habilitar WAL y verificar su resultado. Usar `synchronous = FULL` para el estado de consentimiento. WAL mejora la concurrencia entre lectura y escritura, pero mantiene un único escritor simultáneo y exige almacenamiento local al mismo host. Mantener transacciones breves y responder de forma reintentable cuando persista la contención. [WAL](https://sqlite.org/wal.html), [PRAGMA](https://sqlite.org/pragma.html).

Modelo lógico; los campos de dominio y sus DTO se fijan con P1 en el TDD, no se duplican aquí como contratos incompatibles:

| Tabla | Integridad / índices mínimos |
|---|---|
| `users` | `id` PK, correo normalizado único, hash de contraseña, `primary_device_id` nullable y `device_epoch`. |
| `sessions` | Hash de token único, FK a usuario, expiración/revocación; índice por usuario y expiración. |
| `groups`, `memberships` | FK grupo/usuario, unicidad `(group_id, user_id)`, estado/rol; índice de membresías activas por usuario. |
| `invitations` | Hash del secreto único, grupo, caducidad, consumo y permisos de emisor. |
| `alarm_requests` | PK, FK grupo/creador, versión, estado, tiempo UTC entero, zona IANA; índice `(creator_uid, updated_at)`. |
| `alarm_recipients` | PK compuesta propuesta/usuario, FK correspondientes, decisión y revisión; índice `(recipient_uid, request_id)`. |
| `device_schedules` | FK al destinatario de la propuesta, dispositivo, ocurrencia, versiones y epoch; unicidad de identidad de ocurrencia según contrato P1/P4. |
| `devices` | FK usuario, identificador, plataforma, token de push privado y estado. |
| `tasks` | FK grupo/asignado; vínculo opcional desde propuesta y permisos de membresía. |
| `operations` | `UNIQUE(actor_uid, operation_id)`, operación, hash canónico de entrada y resultado contractual. |
| `outbox_events` | Evento privado, destinatario, versión, intentos, próxima ejecución y lease; índice de pendientes. |
| `change_events` | Secuencia interna, destinatario, entidad/versión y tombstone; índice `(recipient_uid, sequence)`. |
| `agent_sessions` | Propietario/grupo, estado mínimo y expiración; acceso solo por servicios autorizados. |

Usar `CHECK` para enumeraciones/rangos y FK compuestas cuando eviten relaciones entre grupos distintos. No elegir `ON DELETE CASCADE` indiscriminado para borrar auditoría o alarmas aceptadas. Revocar pertenencia genera eventos de invalidación para clientes, manteniendo mínimos necesarios para reconciliar. No devolver filas SQL completas: serializadores con campos explícitos excluyen secretos.

`better-sqlite3` proporciona transacciones y consultas preparadas; sus callbacks de transacción son síncronos. No ejecutar llamadas de red, modelo, `await` ni push dentro de ellos. El servidor obtiene datos externos fuera de la transacción y después revalida versiones/permiso al escribir. [API del driver](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md).

## 3. Sesiones y autorización

- `POST /v1/auth/register`: valida correo/contraseña, crea usuario y sesión; define límites de cuerpo y frecuencia.
- `POST /v1/auth/login`: verifica Argon2id y devuelve token opaco y expiración; errores sin revelar detalles innecesarios de la cuenta.
- `GET /v1/auth/me`: devuelve perfil permitido y expiración de sesión autenticada.
- `POST /v1/auth/logout`: revoca la sesión actual.

No hay refresh token en el primer corte: al caducar se vuelve a iniciar sesión. Generar token con un CSPRNG y al menos 32 bytes aleatorios; guardar únicamente su hash criptográfico y no registrarlo en logs. El cliente guarda el secreto en SecureStore, nunca en SQLite, AsyncStorage, URLs o variables `EXPO_PUBLIC`. La duración de sesión es configuración del servidor documentada, no un privilegio escogido por la app. Contraseñas se procesan con Argon2id y parámetros probados en el VPS; no usar SHA-256 como hash de contraseña. [Node crypto](https://nodejs.org/api/crypto.html), [implementación Argon2](https://github.com/ranisalt/node-argon2), [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/).

Middleware valida bearer, caducidad y revocación, y adjunta actor interno. Cada operación/lectura vuelve a comprobar membresía activa, rol, destinatario, dispositivo y recurso. Ser miembro del piso no permite leer una propuesta privada A→B. No se confía en `uid` recibido como identidad del solicitante. Invitaciones: secreto aleatorio almacenado como hash, vencimiento y consumo atómico.

## 4. HTTP, comandos y errores

`POST /v1/operations/{operationName}` transporta el `OperationEnvelope` y payload existentes; nombres como `createAlarmRequest`, `respondToAlarm`, `registerDevice`, `setPrimaryDevice`, `reportSchedule` se mantienen. No envolver ni renombrar DTO unilateralmente. P1/P3 publican fixtures JSON, validación runtime, `OperationReceipt` (`serverTimeEpochMs`, `APPLIED|REPLAYED`) y `AppError` con códigos existentes. No añadir un wrapper obligatorio que rompa `additionalProperties: false`.

| HTTP | Significado y política cliente |
|---|---|
| 400 | Entrada inválida: corregir; no reintento automático idéntico. |
| 401 | Falta/sesión caducada o revocada: pausar outbox de esa cuenta y pedir acceso. |
| 403 / 404 | Acceso denegado o recurso no visible, según política estable del endpoint. |
| 409 | Conflicto de versión o reutilización de `operationId` con otra entrada: reconciliar, no sobreescribir. |
| 429 | Límite temporal; respetar `Retry-After` y backoff. |
| 500 / 503 | Fallo servidor temporal cuando corresponda; conservar la operación para reintento acotado. |

El cuerpo usa `AppError`, conserva `code`, `message`, `retryable` y campos opcionales acordados. P1 define el mapeo de códigos existente al nuevo transporte. Mensajes para usuario sin trazas SQL ni secretos.

Dentro de una transacción: comprobar autorización/versión → reclamar ID idempotente único por actor → mutar dominio → guardar resultado → insertar eventos. Un ID repetido con igual operación/hash devuelve el resultado previo; con otra entrada falla. Probar carreras concurrentes. `ACCEPTED` no equivale a `SCHEDULED`. ACK válido requiere versiones de propuesta/decisión y `deviceEpoch` vigentes; no reabre una propuesta cancelada. La restauración de una copia antigua exige reconciliar también con clientes, no asumir que sus alarmas han retrocedido.

## 5. Sincronización y push

`GET /v1/sync?cursor=...` devuelve cambios autorizados y siguiente cursor opaco. El cursor se vincula a usuario y alcance, se valida en servidor y no otorga acceso por sí mismo. Feed con retención acotada; cursor caducado obliga snapshot completo autorizado. El snapshot y su cursor se calculan coherentemente para no perder cambios. Incluir tombstones/revocaciones mínimas sin filtrar nuevo contenido privado. El móvil aplica lote/cursor en una transacción local y luego reconcilia con P4.

Opcional: `GET /v1/events?cursor=...` mediante SSE autenticado con cabecera bearer, reconexión y último cursor. No poner tokens en query. SSE/polling funcionan mientras el cliente puede ejecutar código; no mantienen Android despierto ni sustituyen push en segundo plano. P5 implementa polling como base y añade SSE solo si queda tiempo.

La outbox de servidor es distinta de la outbox móvil. Un worker toma eventos con lease, entrega después del commit y registra resultados/reintentos. Expo Push Service recibe identificadores/versión mínimos; no órdenes para sonar. Consultar tickets/receipts y desactivar tokens `DeviceNotRegistered`. Un receipt aceptado por el transporte no acredita recepción, consentimiento ni sonido. [Envío Expo](https://docs.expo.dev/push-notifications/sending-notifications/).

**Expo Push Service sigue requiriendo configuración FCM para Android.** No se usa Firebase como base, autenticación o funciones; tampoco hace falta RNFirebase. Si el equipo exige cero servicios Google, el corte usa sincronización al abrir/foreground y declara que no ofrece entrega remota inmediata con la app cerrada. Las alarmas consentidas y ya programadas siguen siendo locales. [Configuración push](https://docs.expo.dev/push-notifications/push-notifications-setup/), [credenciales FCM](https://docs.expo.dev/push-notifications/fcm-credentials/).

## 6. VPS, despliegue y copias

No se conoce dirección, acceso ni dominio del VPS: no inventarlos. P3 documenta hostname, arquitectura, espacio persistente, runtime y responsable al disponer de datos. API detrás de reverse proxy HTTPS; proceso sin root, archivo SQLite fuera del webroot con permisos privados, secretos fuera de git. Un servicio supervisado y cierre ordenado bastan para el hackathon; no añadir Kubernetes ni múltiples escritores.

Configurar límites de cuerpo, timeout, rate limiting, logs redactados y comprobaciones de salud sin filtrar datos. Probar desde dos móviles contra HTTPS válido. No habilitar HTTP sin cifrado en release para sortear un certificado.

Copias con Online Backup API o función `backup()` del driver, con fecha, retención y copia fuera del VPS. Copiar solo el `.db` abierto en WAL puede omitir datos recientes. Probar restauración en otro archivo y `integrity_check`; acordar ventana de pérdida aceptable y no borrar la base buena antes de validar. [SQLite Online Backup](https://sqlite.org/backup.html). Migraciones: backup previo, exclusión, aplicación transaccional cuando proceda y fallo visible; no ejecutar DDL concurrentemente desde cada request.

## 7. Prueba de entrega

A crea → B consulta/responde → C externo o miembro no destinatario recibe denegación. Repetición concurrente produce un efecto; conflicto no pierde estado; fallo de push conserva outbox; reinicio conserva datos; sesión revocada no consulta ni muta. SQLite real en archivo temporal para pruebas de persistencia/reinicio, no solo mocks. P3 aporta scripts de servidor y migraciones; P1 integra CI una vez existan. P5/P4/P6 completan aceptar → programación → ACK → widget → sonido en dos dispositivos. IA P1 consulta contexto autorizado, pide hora faltante y devuelve borrador; nunca decide por el receptor.
