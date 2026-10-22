# alarmaT — Technical Design Document

**Estado:** diseño a implementar, no descripción de una aplicación existente. Fecha de corte solicitada: **22 de octubre de 2026**. TDD significa aquí *Technical Design Document*; este documento incluye también la estrategia de pruebas y el uso de desarrollo guiado por pruebas para las reglas críticas.

Prácticas verificadas y límites del stack: [Android/Expo](ANDROID_PRACTICES.md) y [SQLite y VPS](SQLITE_VPS_PRACTICES.md).

La estructura inicial ya está disponible en [START_HERE](START_HERE.md). Este TDD describe la arquitectura objetivo revisada: **API HTTPS propia y SQLite en el VPS**. El código de `functions/`, la configuración de `firebase/` y las dependencias anteriores son scaffold heredado, no un backend SQLite terminado. Esta actualización de documentación no migra código ni despliega el VPS.

Referencias de producto: [README](../README.md), [funcionalidades](../FEATURES.md). Responsables, horas y entregas: [plan para seis personas](TEAM_PLAN.md).

## 1. Objetivo y alcance

Una persona propone un aviso a otra; quien lo recibe decide si se programa, a qué hora y en qué modalidad. El emisor puede distinguir petición guardada, recepción, aceptación y confirmación de programación. El móvil receptor ejecuta la alarma localmente; el servidor y las notificaciones push no son el reloj del producto.

| Prioridad | Entrega |
|---|---|
| P0 | Auth, grupo e invitación, propuesta a miembros, consentimiento individual, otra hora, rechazo, desactivación, alarma sonora y recordatorio estándar, persistencia, widget, estados verificables, tarea básica y recurrencia semanal. |
| P1 | Rotaciones, intercambios, IA para aclarar o proponer horarios, preferencias avanzadas, gastos, liquidaciones, presupuestos, huchas y sus widgets. |
| P2 | OCR con evidencia, calendario externo, porcentajes, varias monedas, iOS y varios dispositivos de alarma simultáneos. |

El P0 se construye por incrementos. El primer corte es un aviso puntual entre dos teléfonos; no significa que la recurrencia y las tareas P0 estén terminadas. Si el tiempo obliga a recortar, se documentan explícitamente como pendientes.

No se implementan transferencias bancarias, lectura de chats privados ni activación unilateral por IA. El primer grupo tiene entre dos y seis miembros y cada destinatario utiliza un único dispositivo principal de alarma.

## 2. Decisiones de arquitectura

| Decisión | Aplicación concreta |
|---|---|
| App y navegación | Expo + React Native + TypeScript, Expo Router; development builds para dependencias nativas, no Expo Go. |
| Widgets | `expo-widgets`, componentes compatibles con Android y su entorno de ejecución separado; acciones limitadas o deep links según spike. |
| Datos locales de app | `expo-sqlite` para proyección de estado, formularios, outbox y última sincronización. |
| Backend en VPS | Node.js 22 + TypeScript + Fastify; SQLite con `better-sqlite3`, WAL, claves foráneas y transacciones cortas. Un host con disco persistente. |
| Identidad | Correo/contraseña con hash Argon2id; sesiones bearer opacas, hash del token y expiración en servidor; `expo-secure-store` en app. |
| Operaciones compartidas | API HTTPS con `fetch`; valida sesión, pertenencia, versiones, argumentos e idempotencia. SQLite servidor es autoridad compartida; `expo-sqlite` es proyección/outbox privada del móvil. |
| Alarmas audibles P0 | Módulo Expo local `modules/alarm-runtime` con Kotlin/AlarmManager, almacenamiento nativo propio y componentes de sonido/parada/posposición. Alcance exacto se prueba el día 1. |
| Recordatorios estándar | `expo-notifications` para la modalidad de notificación; no demuestra por sí solo una alarma despertador persistente. |
| Push opcional | Expo Push Service + `expo-notifications`; solo pista de cambio. Android necesita configurar credenciales FCM del proveedor de entrega; no requiere Firebase Auth, Firestore ni RNFirebase. El primer recorrido funciona con consulta al abrir/reanudar. |
| Trabajo diferible | Consulta incremental al abrir/reanudar, polling acotado en primer plano y SSE opcional mientras hay conexión. No garantiza recepción con app cerrada. WorkManager solo cuando sea necesario; no es reloj exacto. |
| Diseño del código | TypeScript estricto, funciones de dominio puras, repositorios y adaptadores inyectados por constructor/factorías. |
| IA | P1 en servidor, propuesta estructurada con revisión humana. |

**Expo es la elección por rapidez de desarrollo.** No se mantiene una segunda app Compose. Kotlin se limita al runtime que necesite acceso persistente a Android; no se oculta ese coste de integración. Se fijan versiones compatibles de Expo, React Native, Fastify, `better-sqlite3`, Node y Kotlin en el primer PR, sin inventar versiones para la fecha de corte.

Todas las mutaciones de dominio pasan por la outbox de `expo-sqlite` y la API; la app nunca abre el archivo SQLite del VPS. Una proyección local no demuestra confirmación reciente del servidor. El almacén del runtime nativo es una tercera frontera, responsable exclusivamente de la ejecución consentida.

### Organización propuesta

Organización objetivo: algunas rutas ya tienen scaffold; `server/` y los adaptadores HTTP son trabajo pendiente. `functions/` y `firebase/` quedan como legado hasta la migración coordinada, no como destino para nuevas operaciones:

```text
app/                            # rutas finas Expo Router, layouts y enlaces
src/
  features/auth/                # sesión y pantallas
  features/groups/              # invitaciones y miembros
  features/alarms/               # crear, bandeja y decisiones
  features/tasks/                # tareas básicas y ocurrencias
  features/expenses/             # P1, no crear vacío por adelantado
  domain/                       # IDs, estados, tiempo, puertos y reglas puras
  data/local/                   # SQLite, migraciones y outbox
  data/remote/                  # fetch, sesión y DTO HTTP
  data/repositories/            # coordinación local/remota
  platform/alarms/               # adaptador TypeScript → runtime nativo
  platform/notifications/        # expo-notifications y canales
  platform/sync/                 # cursor, polling/SSE, reintentos y conciliación
  widgets/                      # expo-widgets, acciones y proyecciones
  bootstrap/                    # sesión, recuperación y arranque antes de Router
modules/alarm-runtime/           # módulo Expo local, Kotlin, receptores y store
server/src/                     # backend objetivo P3 (a crear)
  auth/                         # sesiones, contraseñas y autorización
  contracts/                    # validación desde contratos compartidos
  domain/                       # reglas puras servidor
  operations/                   # handlers HTTP con transacciones
  agents/                       # borradores y aclaraciones, nunca consentimiento
  messaging/                    # outbox y push opcional
  persistence/                  # SQLite, migraciones y consultas parametrizadas
  sync/                         # feed autorizado, cursor y SSE opcional
contracts/                      # esquemas, fixtures y errores compartidos
docs/                           # decisiones y evidencia
```

Los archivos `app/` delegan en features; no contienen reglas de negocio. Pantallas y widgets usan puertos/adaptadores, no hacen SQL ni HTTP directamente ni programan alarmas. El dominio no depende de React ni de clases Android. Un proyecto Expo y un módulo nativo acotado; no crear un monorepo complejo ni módulos por cada pantalla.

Config plugins y configuración declarativa conservan permisos/receptores/canales al regenerar el proyecto nativo. No editar únicamente archivos generados que `prebuild --clean` destruiría. Elegir y documentar si se versiona el proyecto nativo generado; CI valida la estrategia elegida. Un cambio nativo exige reconstruir la development build, no basta recargar JavaScript.

## 3. Fuentes de verdad e invariantes

1. SQLite del VPS conserva la propuesta compartida, su versión y la decisión confirmada de cada destinatario. `expo-sqlite` conserva la proyección privada de la app y acciones pendientes. Para alarmas sonoras, el store del módulo nativo conserva el estado autoritativo de ejecución/cancelación de cada ocurrencia local; SQLite lo refleja mediante snapshots versionados.
2. Solo el destinatario puede aceptar/rechazar su propuesta o elegir su hora. Un emisor, un administrador de grupo o un modelo no pueden hacerlo en su lugar.
3. `ACCEPTED` no implica `SCHEDULED`. El registro de programación incluye versión de propuesta, revisión de decisión y dispositivo concreto.
4. Una propuesta pendiente, rechazada, retirada, caducada o con versión nueva sin consentimiento no crea una alarma nueva.
5. Cada ocurrencia tiene una identidad estable. Reintentar aceptación, push o sincronización no añade otra programación equivalente.
6. Detener, posponer o desactivar un aviso no cambia el vencimiento ni el responsable de una tarea.
7. Cancelar remotamente no demuestra que el móvil lo haya aplicado. El emisor ve la confirmación de cancelación del dispositivo o el estado pendiente.
8. Un `firedAt` local significa ejecución del componente de la app; no demuestra que alguien oyera el sonido. `dismissedAt` tampoco significa tarea completada.

## 4. Contrato de tiempo, versiones y estados

### Tiempo y recurrencia

- Transportar instantes como milisegundos UTC enteros y zona como identificador IANA; almacenar como `INTEGER` en SQLite del VPS; validar instantes y zona en TypeScript y convertir a tipos de tiempo nativos en Kotlin. Los cálculos de recurrencia se contrastan con fixtures comunes.
- Conservar fecha y hora local de la propuesta además del instante resuelto. Mostrar la zona al elegir otra hora.
- P0 permite aviso puntual y repetición semanal de un día/hora. La serie queda ligada a la zona del grupo; viajar no cambia automáticamente su hora de origen.
- Para cambio de horario estacional: una hora inexistente se desplaza por la duración del salto; una hora repetida usa la primera ocurrencia. Mostrar al confirmar la próxima fecha/hora resuelta y probar ambos casos. Esta es una decisión de producto que se puede revisar antes de cerrar contratos.
- El destinatario elige `THIS_OCCURRENCE` o `SERIES`. El consentimiento de serie está ligado a su configuración/versionado; cambiarla exige aceptar otra vez.
- El vencimiento de una ocurrencia no caduca toda la serie. `EXPIRED` en una propuesta puntual impide activarla tarde; en una serie se resuelve la siguiente ocurrencia futura y se conserva únicamente el consentimiento de serie vigente.
- El runtime nativo materializa y persiste la próxima ocurrencia antes de programarla. Al disparar, reconciliar la siguiente; el arranque, reinicio y reconciliación nativa reparan interrupciones sin requerir JS en el instante de disparo. No usar una alarma repetitiva inexacta para fingir precisión semanal.
- Si se pierde una ocurrencia, marcarla como vencida y calcular la siguiente; nunca hacer sonar inmediatamente una alarma antigua al recuperar conexión. La capacidad de recuperar cada caso debe validarse en dispositivo.

### Estados separados

No se implementa un único enum que mezcle red, consentimiento y sistema operativo:

| Dimensión | Valores propuestos |
|---|---|
| Propuesta compartida | `ACTIVE`, `WITHDRAWN`, `EXPIRED` |
| Recepción por destinatario/dispositivo | `NOT_ACKNOWLEDGED`, `RECEIVED` y versión recibida |
| Decisión individual | `PENDING`, `ACCEPTED`, `REJECTED`, `DISABLED`, `NEEDS_REVIEW` |
| Programación local por ocurrencia | `NOT_SCHEDULED`, `PENDING_PERMISSION`, `SCHEDULING`, `SCHEDULED`, `CANCEL_PENDING`, `CANCELLED`, `FIRED`, `FAILED`, `EXPIRED` |
| Sincronización de una operación | `QUEUED`, `SENDING`, `CONFIRMED`, `CONFLICT`, `FAILED_PERMANENT` |

`requestVersion` aumenta cuando el emisor modifica título, destinatarios, horario, modalidad o recurrencia. El backend invalida el consentimiento aplicable y el receptor retira la programación anterior **cuando recibe el cambio**. Hasta entonces puede sonar la versión vieja: debe figurar como actualización pendiente, no como sincronizada.

`decisionRevision` aumenta al aceptar, cambiar hora, rechazar o desactivar. El acuse local solo se admite para el par vigente `(requestVersion, decisionRevision)` y el `deviceEpoch` principal. Para una serie, `occurrenceId` identifica una fecha concreta; su estado no sustituye al estado de consentimiento de toda la serie.

### Secuencia principal

1. A crea una propuesta mediante una operación idempotente. La API verifica sesión y pertenencia y guarda propuesta, destinatarios y evento de actividad en una transacción.
2. B consulta el feed autorizado al abrir/reanudar (polling o SSE opcional en primer plano), recupera el DTO vigente, lo guarda en `expo-sqlite` y confirma recepción. Si se habilita push, solo transporta identificadores/versión; puede duplicarse, retrasarse o no llegar.
3. B acepta una versión y horario concretos. La API confirma la decisión con control de versión; si hay conflicto, la UI presenta el estado nuevo antes de aceptar otra vez.
4. B entrega al runtime nativo la decisión confirmada; el runtime persiste `SCHEDULING`, comprueba permisos y programa con identidad estable. Solo entonces registra `SCHEDULED` y encola el acuse.
5. A muestra «programada» cuando recibe el acuse válido de B. Antes muestra aceptación pendiente de activación/confirmación.
6. Al disparar, el receptor consulta el store nativo y verifica que esa identidad siga activa. Presenta la modalidad aceptada. Detener/posponer registran una acción independiente de la tarea.

No hay transacción atómica entre `expo-sqlite`, el store nativo, AlarmManager y SQLite del VPS. La recuperación se basa en registro persistido antes de la operación, identidad estable y reconciliación idempotente después. La app no puede demostrar con una consulta universal a AlarmManager que todos sus avisos siguen registrados: vuelve a programar de forma segura los avisos deseados cuando corresponde y conserva el momento del último acuse.

## 5. Contratos de datos y API

Los JSON Schema y fixtures de `contracts/` ya fijan la v1 de operaciones, documentos y errores; se conservan sus nombres, campos y enums al cambiar el transporte. Los títulos históricos que parecen rutas de documentos no definen endpoints HTTP. El backend valida entradas en runtime y obtiene `uid` de la sesión opaca verificada, nunca de un campo que el cliente afirme como identidad.

### Persistencia del servidor y compatibilidad de DTO

| Tabla objetivo | Propiedad y restricciones mínimas |
|---|---|
| `users` | UID estable, correo normalizado único, hash Argon2id, preferencias, `primaryDeviceId`, `deviceEpoch`. |
| `sessions` | Hash de token opaco, usuario, expiración y revocación; nunca devolver el hash. |
| `groups`, `memberships` | Grupo, zona/moneda, membresía/rol/estado; clave única `(groupId, uid)`. |
| `invitations` | Hash del token, emisor, caducidad y usos; consumo atómico, solo servidor. |
| `alarm_requests` | Identidad/grupo y campos del DTO `AlarmRequest`: creador, título, nota/tarea opcionales, versión, estado, tiempo, modalidad y recurrencia. |
| `alarm_recipients` | Clave `(requestId, uid)`; recepción, decisión, revisión inicial `1`, versión aceptada y hora/ámbito elegidos. |
| `device_schedules` | Clave por destinatario/ocurrencia/dispositivo/epoch; versiones, modalidad, mecanismo, estado e instantes del DTO `Schedule`. |
| `tasks` | Tarea, grupo, responsable, activación/vencimiento, estado y versión; vínculo con propuesta. |
| `devices` | Propietario, plataforma, actividad y token push opcional privado. |
| `operations` | Clave única `(uid, operationId)`, hash canónico del payload y nombre de operación, recibo/versiones; replay autorizado. |
| `change_events` | Secuencia interna, entidad/versión, audiencia y fecha; fuente de sincronización autorizada y revocaciones. |
| `outbox_events` | Entrega opcional por evento/destinatario; estado, intentos y siguiente intento; no confundir con outbox móvil. |

SQLite del VPS usa migraciones versionadas, `PRAGMA foreign_keys = ON` por conexión, WAL y `busy_timeout` finito. Índices cubren membresía, destinatario/propuesta, operaciones y feed. Las transacciones cortas comprueban permisos/versiones y escriben cambios con restricciones únicas; SQLite admite un escritor por vez. Un único host con volumen local persistente: no compartir el archivo por red ni usar varias réplicas con copias divergentes. Backup consistente y prueba de restauración según [guía SQLite/VPS](SQLITE_VPS_PRACTICES.md).

El mapeo SQL → DTO mantiene `creatorUid`, `recipientUids`, `createdAtEpochMs`, `updatedAtEpochMs`, `effectiveAtEpochMs`, `reportedAtEpochMs` y el resto de nombres exactos de los esquemas. IDs y estructura de transporte no se insertan dentro de objetos con `additionalProperties: false`. P1/P3 fijan fixtures HTTP antes de conectar P2/P5.

### Transporte HTTP objetivo

Todas las rutas son objetivo a implementar en `server/src/`, no endpoints ya desplegados. La app usa `fetch` sobre HTTPS y `Authorization: Bearer <token-opaco>`; token privado guardado con SecureStore, nunca en URL, logs o fixtures.

| Ruta | Contrato y control |
|---|---|
| `POST /v1/auth/register`, `POST /v1/auth/login` | Correo/contraseña; registro/login devuelve sesión, expiración y usuario público. Hash Argon2id y limitación de intentos en servidor. |
| `GET /v1/auth/me` | Sesión vigente → usuario público; no publicar hashes ni datos privados de otros. |
| `POST /v1/auth/logout` | Revoca la sesión actual en servidor; limpiar sesión/datos y cancelar avisos locales según política offline. |
| `POST /v1/operations/{operationName}` | Sobre v1 intacto; whitelist de operaciones, autorización por actor y transacción. Éxito devuelve `OperationReceipt` directamente; error devuelve `AppError` directamente. |
| `GET /v1/groups/{groupId}/alarm-requests` | Lista paginada limitada al creador/destinatario con membresía activa; nunca lectura indiscriminada de grupo. |
| `GET /v1/groups/{groupId}/alarm-requests/{requestId}` | Detalle autorizado. Wrapper HTTP con IDs y DTO internos intactos; P1/P3 cierran fixture de lista/detalle. |
| `GET /v1/sync?cursor=<opaco>` | Cambios paginados para la sesión actual; cursor validado y ligado a actor/ámbito, sin exponer una secuencia global como permiso. |
| `GET /v1/events?cursor=<opaco>` (opcional) | SSE en primer plano con el mismo bearer en cabecera y ámbito de acceso; señal para consultar `/v1/sync`, no fuente independiente de autoridad. |

HTTP separa transporte de dominio: `400` → `INVALID_ARGUMENT`, `401` → `UNAUTHENTICATED`, `403` → `FORBIDDEN`/`DEVICE_NOT_PRIMARY` cuando no filtra existencia, `404` → `NOT_FOUND` para entidades fuera de ámbito, `409` → `VERSION_CONFLICT`/`EXPIRED`, `429` → `RATE_LIMITED`, `503` → `TEMPORARY_UNAVAILABLE`. No añadir códigos nuevos al enum v1 para errores SQL o de infraestructura. Errores de proxy/red sin JSON válido se normalizan en el adaptador, no se interpretan como recibos. Un timeout tras enviar exige reintentar el mismo `operationId`, no crear otro.

El feed entrega únicamente datos autorizados; una baja de grupo emite una señal mínima de revocación para borrar la proyección local, sin revelar contenidos actuales del grupo. Cursor inválido/caducado permite resincronización completa autorizada; jamás saltar eventos silenciosamente. P5 guarda cursor y página aplicada en la misma transacción local y deduplica por identidad/versión. Desconectar polling/SSE al cerrar sesión y eliminar listeners de la cuenta anterior. Sin conexión en primer plano ni push operativo, una propuesta nueva se recibe al abrir/reanudar; ninguna ruta promete despertar JS.

### Sobre común de operaciones

```json
{
  "schemaVersion": 1,
  "operationId": "uuid-generado-una-vez-por-accion",
  "groupId": "grupo",
  "entityId": "propuesta",
  "expectedRequestVersion": 3,
  "expectedDecisionRevision": 1,
  "payload": {}
}
```

Los campos de versión solo son obligatorios en operaciones aplicables. Un reintento conserva `operationId` y payload. Reutilizar el ID con contenido diferente se rechaza. Respuesta común: `operationId`, `status` (`APPLIED` o `REPLAYED`), `serverTimeEpochMs`, versiones nuevas y resultado; un conflicto devuelve el código y permite recuperar el documento actual.

| Operación | Permisos, precondición y resultado |
|---|---|
| `createGroup`, `createInvitation`, `joinGroup` | Usuario autenticado; invitación válida y no agotada; devolver pertenencia sin publicar el token secreto. |
| `registerDevice`, `setPrimaryDevice` | Solo propietario. Cambiar principal aumenta `deviceEpoch`; advertir de retirada pendiente en el dispositivo anterior. |
| `createAlarmRequest` | Miembro activo; destinatarios activos, horario futuro y payload válido; crear versión 1. |
| `reviseAlarmRequest`, `withdrawAlarmRequest` | Creador activo, versión esperada; invalidar consentimiento previo o retirar. |
| `ackReceived` | Destinatario y dispositivo autorizado; acuse de versión conocida, sin retroceder el contador. |
| `respondToAlarm` | Solo destinatario; versión actual, decisión y hora válida; incrementar revisión en transacción. |
| `reportSchedule` | Solo destinatario/dispositivo principal; versiones vigentes; acuse idempotente por ocurrencia. |
| `disableAlarm` | Solo destinatario; cancelar localmente de inmediato y comunicar decisión; un conflicto no reactiva el aviso local. |
| `createTask`, `completeTask`, `cancelTask` | Miembro autorizado, versión vigente; invalidar avisos de esa tarea al completarla/cancelarla. |

Códigos de aplicación: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_ARGUMENT`, `VERSION_CONFLICT`, `EXPIRED`, `DEVICE_NOT_PRIMARY`, `RATE_LIMITED`, `TEMPORARY_UNAVAILABLE`. Reintentar solo fallos transitorios con backoff y jitter; no reintentar indefinidamente validaciones o falta de permisos. No revelar existencia de entidades a usuarios sin acceso.

La misma transacción SQLite escribe el estado, el recibo idempotente y el evento `change_events`; si se habilita push, también inserta su entrega en la outbox del servidor. Un worker procesa esa outbox después del commit con reintentos. No hacer llamadas al proveedor ni al modelo dentro de una transacción. La entrega puede repetirse: cliente recupera estado vigente y deduplica. No prometer exactly-once de transporte.

### Puertos TypeScript y contrato del módulo nativo

```typescript
interface AlarmRepository {
  subscribeInbox(onChange: (items: AlarmSummary[]) => void): () => void;
  submit(command: AlarmCommand): Promise<OperationReceipt>;
  reconcile(): Promise<ReconcileResult>;
}

interface AlarmRuntime {
  schedule(spec: LocalOccurrence): Promise<ScheduleResult>;
  cancel(key: OccurrenceKey): Promise<CancelResult>;
  getSnapshot(): Promise<RuntimeSnapshot>;
  getCapabilities(): Promise<AlarmCapabilities>;
}

interface Clock { nowEpochMs(): number; }
```

Son firmas de diseño, no tipos completos implementados. `ScheduleResult` distingue programado, permiso pendiente y error. El runtime no llama a la API ni accede al SQLite del VPS. La UI solicita permisos desde contexto permitido. Una identidad estable incorpora usuario, propuesta, ocurrencia y dispositivo; el módulo nativo evita colisiones y cancela la programación reemplazada.

**Frontera JS/nativo:** una base abierta con `expo-sqlite` no se presupone accesible de forma segura desde un receptor Kotlin. El runtime mantiene un store privado propio para especificación consentida, versiones, estado, tombstones y siguiente ocurrencia. El receptor consulta ese store sin arrancar React ni esperar un callback JS. Detener/posponer y recuperación de arranque funcionan en el runtime, que registra eventos/snapshot para conciliación posterior.

Orden de programación: confirmación de servidor → comando nativo persistido → AlarmManager → resultado nativo con revisión → proyección SQLite → acuse en outbox. Si la app muere entre pasos, el snapshot nativo permite completar proyección/acuse. SQLite no puede sobrescribir un tombstone nativo con una proyección vieja. Cancelar localmente siempre llega primero al runtime; una sincronización posterior no lo reactiva sin nueva decisión válida. Se prueban fallos entre cada frontera. No se afirma atomicidad entre cuatro sistemas.

La modalidad estándar usa un adaptador de `expo-notifications` y conserva su identificador de programación en SQLite; se concilia con los avisos registrados que expone esa API. La modalidad sonora usa exclusivamente el módulo nativo. Una misma ocurrencia no se programa en ambos mecanismos. El acuse identifica modalidad y mecanismo, y cambiar modalidad exige cancelar la programación anterior. La UI no presenta ambas modalidades con las mismas garantías.

La recepción push opcional se implementa con `expo-notifications` y Expo Push Service. Android requiere configurar el proyecto/credenciales FCM de transporte; esto no reintroduce Auth/Firestore ni RNFirebase como backend. P1/P3/P5 verifican una development build y credenciales reales antes de declarar push disponible. Un push visible no se duplica manualmente si el sistema ya lo presentó. La sincronización se recupera siempre mediante la API; una alarma ya programada suena sin push y sin JavaScript vivo.

## 6. Offline, recuperación y límites de Android

| Situación | Comportamiento diseñado |
|---|---|
| Crear/aceptar/cambiar hora sin red | Guardar acción pendiente; no crear ni sustituir una alarma con una aceptación nueva hasta validar versión y pertenencia en servidor. La UI distingue esta política de una alarma ya activa. |
| Rechazar/desactivar sin red | Cancelar localmente inmediatamente, mantener tombstone y encolar decisión. Una proyección remota antigua no puede reactivarla al sincronizar. |
| Alarma aceptada y programada, luego sin red | Mantener ejecución local. No requiere push a la hora del aviso. |
| Cancelación remota y receptor offline | Mostrar retirada solicitada, acuse pendiente; el móvil puede sonar hasta recibirla. |
| Falta de permiso | Mantener aceptación, mostrar `PENDING_PERMISSION` y acción para resolver. No degradar de alarma sonora a recordatorio silenciosamente. |
| Muerte del proceso tras programar | Recuperar estado persistido y reconciliar sin duplicar. Probar separadamente de forzar detención desde ajustes. |
| Reinicio o cambio de hora/zona | Receptor de sistema y conciliación con reglas de tiempo; reprogramar solo futuras, vigentes y consentidas. P0 valida tras desbloqueo; no promete ejecución antes de primer desbloqueo. |
| Revocación de acceso a alarmas exactas | Detectar capacidad al volver/sincronizar, reflejar pendiente y pedir acción; un acuse histórico no garantiza capacidad actual. |
| Cierre de sesión | Cancelar avisos y borrar datos privados localmente, desvincular token y registrar lo posible antes de finalizar sesión. |
| Cambio del móvil principal | No permitir nuevos acuses del epoch viejo; mostrar revocación pendiente si el móvil viejo está offline. No garantiza retirar sus alarmas sin comunicación. |
| Usuario retirado del grupo | Servidor bloquea acceso y operaciones; cliente retira avisos al conocerlo. Dispositivo desconectado puede conservar una programación anterior. |

La entrega push, Doze, ahorro de batería, fabricante y permisos limitan entrega y ejecución. El spike debe validar cada modalidad en development build; si la vía nativa falla, la alarma sonora P0 sigue bloqueada y se recortan módulos secundarios. No se presenta una notificación como sustitución completada. No se garantiza sonar con dispositivo apagado, tras una detención forzada ni ignorando modo silencio/no molestar. Una pantalla a pantalla completa solo se implementa cuando los permisos, elegibilidad y restricciones de plataforma lo permitan; la demo no debe depender de eludirlos.

La alarma sonora requiere concretar recepción, audio, duración máxima, parada y notificación visible en la prueba de viabilidad del día 1. Elegir los componentes Android permitidos según SDK objetivo. Un `BroadcastReceiver` no debe ejecutar audio indefinidamente. Si hace falta un foreground service, debe cumplir tipo, permisos y restricciones de inicio; no se selecciona un tipo arbitrario solo para superar una excepción.

## 7. Seguridad, coste y observabilidad

- Cada handler autentica la sesión y verifica membresía/rol/participación dentro de su operación; SQLite no aporta reglas de acceso por usuario. Toda consulta usa parámetros y ámbitos explícitos. Un UID o ID de grupo enviado por el cliente nunca autoriza acceso.
- Sesiones opacas aleatorias de alta entropía; guardar solo hash en servidor, expiración y revocación. Contraseñas con Argon2id y límites de login/registro; HTTPS obligatorio en despliegue. SecureStore protege el token del cliente, no sustituye autorización del servidor.
- Limitar frecuencia de propuestas, tamaño de texto y destinatarios. Silenciar propuestas no revoca avisos aceptados. No publicar archivo SQLite, WAL, backups, tokens ni secretos del proveedor/modelo.
- Logs estructurados con `operationId`, entidad, versión, resultado y duración; evitar texto de alarmas, tokens y datos personales. Correlación local/servidor para diagnosticar duplicados.
- Polling/SSE solo mientras corresponde, consultas paginadas y desconexión por cuenta/grupo. Widget usa proyección preparada; no presume acceso a SQLite/React desde su runtime aislado ni consulta toda la base. Si una acción requiere JS, abre una ruta explícita.
- Tests locales con API y base SQLite temporal real, migraciones y usuarios sintéticos. Separar base de pruebas/demo; validar backup/restauración, permisos del volumen, reinicio del servicio y límites de CPU/disco del VPS. No asumir coste cero de push o modelo.
- Registrar antes de demo: latencia propuesta→recepción, aceptación→programación, duplicados, error horario local y resultados por dispositivo/API. Medir tamaño/rendimiento sobre release y colas/contención de SQLite bajo la carga prevista.

## 8. Estrategia de pruebas

El enfoque de desarrollo guiado por pruebas se reserva para consentimiento, versiones, idempotencia, tiempo y cálculos. No escribir tests que repliquen literalmente cada función ni snapshots de pantallas sin comportamiento relevante.

| Nivel | Casos imprescindibles | Evidencia |
|---|---|---|
| Unidad TypeScript/dominio | Transiciones permitidas, consentimiento por versión, rechazo no altera tarea, otra hora no altera vencimiento, duplicados, recurrencia/DST, tombstones offline. | Tests con Clock y runtime falsos; sin esperar horas reales. |
| Unidad TypeScript/backend | Validación, pertenencia, permisos de creador/destinatario, control de versión, idempotencia/payload diferente, caducidad. | Resultados deterministas y errores de dominio. |
| Contrato | Fixtures válidos/incorrectos, mismos enum/tiempos, campos opcionales, errores. | TypeScript y Kotlin consumen los mismos ejemplos JSON. |
| API + SQLite temporal | Registro/login/logout, sesión caducada/revocada, usuario externo, consultas/feed fuera de ámbito, invitaciones, carreras aceptar/editar, replay y payload diferente; migraciones/rollback y reinicio tras commit. | HTTP real o Fastify injection + archivo SQLite temporal; dos usuarios y un tercero, fixtures compartidos y prueba de restauración. |
| Integración local/nativa | SQLite/outbox y store nativo, reconciliación tras fallo entre persistir/programar/reportar, cancelación/sustitución con misma identidad. | Estado final y número de programaciones verificables. |
| UI/Widget | Aceptar/rechazar/otra hora, permiso denegado, acción pendiente, deep link correcto, cambio de cuenta. | Pruebas de los recorridos clave y revisión en launcher. |
| Dispositivo real | Dos teléfonos; pantalla bloqueada, cierre de proceso, Doze, reinicio/desbloqueo, conexión perdida, permisos revocados, detener/posponer. | Modelo, API, pasos, hora prevista/real y resultado; no extrapolar a todos los fabricantes. |

### Casos de aceptación que bloquean la entrega

1. A envía a B y C: aceptar B no programa en C; rechazar C mantiene inactiva su copia.
2. B acepta cinco veces por reintentos: una sola ocurrencia local activa.
3. B cambia hora: se retira la anterior y se conserva el vencimiento de la tarea.
4. A modifica versión mientras B acepta: conflicto visible, sin programar la versión nueva sin consentimiento.
5. A cancela con B offline: A ve pendiente; B cancela al reconectar; no se afirma cancelación aplicada antes del acuse.
6. B desactiva offline: no suena localmente ni reaparece por un snapshot antiguo.
7. Permiso denegado: estado aceptado/pending activación, nunca «programada» sin intento correcto.
8. Alarma ya programada: dispara sin red con proceso cerrado en los dispositivos declarados; se puede detener y posponer.
9. Operación HTTP con reintentos: mismo resultado sin duplicar propuesta, evento ni decisión.
10. Usuario ajeno: no lee DTO privados ni puede mutar un grupo pasando su ID.
11. Reinicio, fecha pasada y cambio estacional: ninguna alarma antigua se dispara inesperadamente; próximas ocurrencias se recalculan conforme al contrato.

CI propuesta cuando exista el código: TypeScript estricto, lint, tests dominio/UI, tests HTTP/autorización con SQLite temporal real y fixtures compartidos; build de development/release Android y tests Kotlin del módulo local cuando exista. Añadir comprobaciones de configuración Expo y lockfile reproducible. Instrumentación y pruebas físicas se documentan aparte; pasar unit tests no valida alarmas en segundo plano.

## 9. Módulos P1: contratos antes de ampliar

- **IA:** petición → datos autorizados del grupo → propuesta estructurada → validación determinista → revisión humana. Timeout/fallo deja operativo el flujo manual. Un texto del usuario o una tarea no puede añadir herramientas o permisos al agente.
- **Gastos:** cantidades enteras en céntimos, moneda única del grupo, participaciones cuya suma es el total; céntimos sobrantes asignados en orden estable de UID. Liquidaciones no son gastos nuevos.
- **Huchas:** libro de movimientos idempotentes; aportaciones previstas no aumentan saldo; aportación realizada no consume presupuesto; compra desde hucha consume presupuesto y saldo sin crear de nuevo una deuda personal.
- **Rotaciones/intercambios:** propuesta con versión de origen y aceptaciones de afectados; el responsable actual se conserva hasta aprobar. El modelo no define equidad unilateralmente.

No crear estos módulos en paralelo a costa de la aceptación, persistencia y pruebas del P0. Las decisiones de contabilidad necesitan tests específicos cuando se implementen.

## 10. Decisiones que deben cerrarse en el día 1

| Decisión pendiente | Owner y condición para cerrar |
|---|---|
| Expo SDK, plugins, API HTTPS, `minSdk`/`targetSdk`, toolchain | P1 y P6; development build instalada en teléfonos disponibles y requisitos verificados. |
| Módulo nativo, audio/presentación, permisos y pantalla completa | P4; spike real con app cerrada/pantalla bloqueada y documentación de restricciones. |
| Sesiones propias e invitaciones | P2 y P3; correo/contraseña, Argon2id, expiración/revocación y flujo reproducible. |
| VPS y entorno demo | P3 y P6; confirmar host, HTTPS, disco persistente, variables, backup/restauración y acceso del equipo. No inventar credenciales o dominio. |
| Política DST propuesta y límites de snooze | P1, P4 y producto; fixture aceptado y texto visible al usuario. |
| Nivel P1 que entra realmente | P6 con el equipo al cierre del día 2; solo si pasa el recorrido P0 y queda capacidad de verificación. |

Cada decisión se registra como ADR breve con contexto, elección, alternativa y consecuencia. Si cambia este contrato, se actualizan fixtures y consumidores en el mismo cambio o con una transición compatible; un documento no puede afirmar una garantía que la demo no verifica.

Decisiones ya cerradas por P1: [ADR-001 · base Expo y lockfile](adr/001-base-expo-y-lockfile.md), [ADR-002 · ejes de estado](adr/002-ejes-de-estado.md) y [ADR-003 · política de cambio horario](adr/003-politica-dst.md). Los payloads resultantes están en [CONTRACTS](CONTRACTS.md).

La migración de backend se recoge en [ADR-004](adr/004-vps-sqlite.md). `npm run check` y scripts heredados pueden seguir compilando `functions/`; no son evidencia de que exista ni funcione la API objetivo. Cada nueva suite y comando de `server/` se añade con su implementación.
