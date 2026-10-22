# alarmaT — Technical Design Document

**Estado:** diseño a implementar, no descripción de una aplicación existente. Fecha de corte solicitada: **22 de octubre de 2026**. TDD significa aquí *Technical Design Document*; este documento incluye también la estrategia de pruebas y el uso de desarrollo guiado por pruebas para las reglas críticas.

Prácticas verificadas y límites del stack: [Android/Expo](ANDROID_PRACTICES.md) y [Firebase](FIREBASE_PRACTICES.md).

La estructura inicial ya está disponible en [START_HERE](START_HERE.md). Este TDD sigue describiendo la implementación objetivo; los adaptadores de arranque todavía no completan sus garantías.

Referencias de producto: [README](../README.md), [funcionalidades](../FEATURES.md). Responsables, horas y entregas: [plan para seis personas](TEAM_PLAN.md).

## 1. Objetivo y alcance

Una persona propone un aviso a otra; quien lo recibe decide si se programa, a qué hora y en qué modalidad. El emisor puede distinguir petición guardada, recepción, aceptación y confirmación de programación. El móvil receptor ejecuta la alarma localmente; el servidor y FCM no son el reloj del producto.

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
| Backend Firebase | Auth, Firestore, Cloud Functions TypeScript y FCM mediante `@react-native-firebase/app`, `auth`, `firestore`, `functions` y `messaging`, API modular. Un único SDK cliente. |
| Operaciones compartidas | Functions callable valida identidad, pertenencia, versiones, argumentos e idempotencia. Lecturas Firestore proyectadas a SQLite. |
| Alarmas audibles P0 | Módulo Expo local `modules/alarm-runtime` con Kotlin/AlarmManager, almacenamiento nativo propio y componentes de sonido/parada/posposición. Alcance exacto se prueba el día 1. |
| Recordatorios estándar | `expo-notifications` para la modalidad de notificación; no demuestra por sí solo una alarma despertador persistente. |
| Push | FCM directo mediante RNFirebase, sin Expo Push Service adicional. Pista de cambio; nunca orden unilateral de sonar. |
| Trabajo diferible | Reconciliación al abrir/reanudar, listener mientras conectado y recepción remota oportunista. WorkManager nativo solo donde sea necesario; no es reloj exacto. |
| Diseño del código | TypeScript estricto, funciones de dominio puras, repositorios y adaptadores inyectados por constructor/factorías. |
| IA | P1 en servidor, propuesta estructurada con revisión humana. |

**Expo es la elección por rapidez de desarrollo.** No se mantiene una segunda app Compose. Kotlin se limita al runtime que necesite acceso persistente a Android; no se oculta ese coste de integración. Se fijan versiones compatibles de Expo, React Native, RNFirebase, Node y Kotlin en el primer PR, sin inventar versiones para la fecha de corte.

No se mantienen dos colas de escritura offline: mutaciones de dominio por outbox SQLite + Functions; no mezclar escrituras directas pendientes de Firestore. La caché Firestore no reemplaza el registro operativo local. Un snapshot de caché no demuestra confirmación reciente del servidor.

### Organización propuesta

Todas estas rutas son **a crear**, no componentes existentes:

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
  data/remote/                  # RNFirebase y DTO callable
  data/repositories/            # coordinación local/remota
  platform/alarms/               # adaptador TypeScript → runtime nativo
  platform/notifications/        # expo-notifications y canales
  platform/sync/                 # listeners, reintentos y reconciliación
  widgets/                      # expo-widgets, acciones y proyecciones
  bootstrap/                    # registro background antes de Expo Router
modules/alarm-runtime/           # módulo Expo local, Kotlin, receptores y store
functions/src/
  contracts/                    # validación runtime y DTO
  domain/                       # reglas puras servidor
  operations/                   # handlers callable
  messaging/                    # FCM y eventos
  persistence/                  # transacciones Firestore
contracts/                      # esquemas, fixtures y errores compartidos
firebase/                       # reglas, índices y configuración sin secretos
docs/                           # decisiones y evidencia
```

Los archivos `app/` delegan en features; no contienen reglas de negocio. Pantallas y widgets usan puertos/adaptadores, no importan Firestore ni programan directamente alarmas. El dominio no depende de React ni de clases Android. Un proyecto Expo y un módulo nativo acotado; no crear un monorepo complejo ni módulos por cada pantalla.

Config plugins y configuración declarativa conservan permisos/receptores/canales al regenerar el proyecto nativo. No editar únicamente archivos generados que `prebuild --clean` destruiría. Elegir y documentar si se versiona el proyecto nativo generado; CI valida la estrategia elegida. Un cambio nativo exige reconstruir la development build, no basta recargar JavaScript.

## 3. Fuentes de verdad e invariantes

1. Firestore conserva la propuesta compartida, su versión y la decisión confirmada de cada destinatario. SQLite conserva la proyección de la app y acciones pendientes. Para alarmas sonoras, el store del módulo nativo conserva el estado autoritativo de ejecución/cancelación de cada ocurrencia local; SQLite lo refleja mediante snapshots versionados.
2. Solo el destinatario puede aceptar/rechazar su propuesta o elegir su hora. Un emisor, un administrador de grupo o un modelo no pueden hacerlo en su lugar.
3. `ACCEPTED` no implica `SCHEDULED`. El registro de programación incluye versión de propuesta, revisión de decisión y dispositivo concreto.
4. Una propuesta pendiente, rechazada, retirada, caducada o con versión nueva sin consentimiento no crea una alarma nueva.
5. Cada ocurrencia tiene una identidad estable. Reintentar aceptación, push o sincronización no añade otra programación equivalente.
6. Detener, posponer o desactivar un aviso no cambia el vencimiento ni el responsable de una tarea.
7. Cancelar remotamente no demuestra que el móvil lo haya aplicado. El emisor ve la confirmación de cancelación del dispositivo o el estado pendiente.
8. Un `firedAt` local significa ejecución del componente de la app; no demuestra que alguien oyera el sonido. `dismissedAt` tampoco significa tarea completada.

## 4. Contrato de tiempo, versiones y estados

### Tiempo y recurrencia

- Transportar instantes como milisegundos UTC enteros y zona como identificador IANA; convertir a `Timestamp` en Firestore; validar instantes y zona en TypeScript y convertir a tipos de tiempo nativos en Kotlin. Los cálculos de recurrencia se contrastan con fixtures comunes.
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

1. A crea una propuesta mediante una operación idempotente. Functions verifica pertenencia y guarda propuesta, destinatarios y evento de actividad en una transacción.
2. La notificación FCM lleva identificadores y versión, con contenido mínimo. B recupera el documento vigente, lo guarda en SQLite y confirma recepción. FCM puede duplicarse o retrasarse.
3. B acepta una versión y horario concretos. Functions confirma la decisión con control de versión; si hay conflicto, la UI presenta el estado nuevo antes de aceptar otra vez.
4. B entrega al runtime nativo la decisión confirmada; el runtime persiste `SCHEDULING`, comprueba permisos y programa con identidad estable. Solo entonces registra `SCHEDULED` y encola el acuse.
5. A muestra «programada» cuando recibe el acuse válido de B. Antes muestra aceptación pendiente de activación/confirmación.
6. Al disparar, el receptor consulta el store nativo y verifica que esa identidad siga activa. Presenta la modalidad aceptada. Detener/posponer registran una acción independiente de la tarea.

No hay transacción atómica entre SQLite, el store nativo, AlarmManager y Firestore. La recuperación se basa en registro persistido antes de la operación, identidad estable y reconciliación idempotente después. La app no puede demostrar con una consulta universal a AlarmManager que todos sus avisos siguen registrados: vuelve a programar de forma segura los avisos deseados cuando corresponde y conserva el momento del último acuse.

## 5. Contratos de datos y API

Los nombres siguientes son el contrato inicial compartido entre TypeScript y Kotlin. Crear JSON Schema y fixtures comunes antes de desarrollar consumidores; validar datos externos en runtime. `uid` se obtiene de Firebase Auth, nunca de un campo que el cliente afirme como identidad.

### Colecciones Firestore

| Ruta | Campos mínimos y propiedad |
|---|---|
| `groups/{groupId}` | `name`, `timeZone`, `currency`, `createdBy`, `createdAt`; funciones de grupo. |
| `groups/{groupId}/members/{uid}` | `role`, `status`, `joinedAt`; pertenencia activa para toda operación. |
| `groups/{groupId}/invitations/{inviteId}` | Hash de token, expiración, usos y emisor; acceso solo servidor, aceptación por operación autenticada. |
| `groups/{groupId}/alarmRequests/{requestId}` | `creatorUid`, `title`, `taskId?`, `requestVersion`, `status`, `timeSpec`, `mode`, `recurrence?`, `createdAt`, `updatedAt`. |
| `groups/{groupId}/alarmRequests/{requestId}/recipients/{uid}` | `receivedVersion`, `decision`, `decisionRevision`, `acceptedRequestVersion?`, `chosenTimeSpec?`, `consentScope?`, `updatedAt`. |
| `groups/{groupId}/alarmRequests/{requestId}/recipients/{uid}/schedules/{occurrenceId}` | `deviceId`, `deviceEpoch`, versiones, `effectiveAt`, `status`, `reason?`, `reportedAt`; acuse de ejecución local, no garantía de sonido. |
| `groups/{groupId}/tasks/{taskId}` | `title`, `assigneeUid`, `activateAt`, `dueAt`, `status`, `version`, `completedBy?`, `completedAt?`; plantilla/ocurrencias semanales vinculadas cuando proceda. |
| `users/{uid}/devices/{deviceId}` | Token FCM, plataforma, última actividad; privado al usuario/servidor. |
| `users/{uid}` | `primaryDeviceId`, `deviceEpoch`, preferencias privadas. |
| `operations/{uid_operationId}` | Resultado idempotente, hash del payload, versión de contrato y caducidad; solo servidor. |
| `groups/{groupId}/activity/{eventId}` | Actor, tipo, entidad, versión, fecha de servidor; inmutable para el cliente. |
| `outbox/{eventId}` | Destinatario, cambio y estado de envío; solo servidor, reintentos idempotentes. |

Lecturas de propuestas limitadas a su creador y destinatarios activos del grupo. Las tareas del grupo son compartidas. Los tokens, las invitaciones y los registros internos no se exponen a otros miembros. La consulta del cliente debe incluir restricciones compatibles con las reglas; Firestore Rules no filtra una consulta demasiado amplia. Mantener `recipientUids` en el documento de propuesta para consultas por destinatario y declarar sus índices en el repositorio.

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

Los campos de versión solo son obligatorios en operaciones aplicables. Un reintento conserva `operationId` y payload. Reutilizar el ID con contenido diferente se rechaza. Respuesta común: `operationId`, `status`, `serverTime`, versiones nuevas y resultado; un conflicto devuelve el código y permite recuperar el documento actual.

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

Las transacciones de dominio escriben también el evento de entrega. Un worker/trigger procesa eventos hacia FCM y registra su resultado. La entrega y los triggers pueden repetirse; el cliente recupera el estado actual y deduplica. No prometer exactly-once de transporte.

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

Son firmas de diseño, no tipos completos implementados. `ScheduleResult` distingue programado, permiso pendiente y error. El runtime no llama a Firebase. La UI solicita permisos desde contexto permitido. Una identidad estable incorpora usuario, propuesta, ocurrencia y dispositivo; el módulo nativo evita colisiones y cancela la programación reemplazada.

**Frontera JS/nativo:** una base abierta con `expo-sqlite` no se presupone accesible de forma segura desde un receptor Kotlin. El runtime mantiene un store privado propio para especificación consentida, versiones, estado, tombstones y siguiente ocurrencia. El receptor consulta ese store sin arrancar React ni esperar un callback JS. Detener/posponer y recuperación de arranque funcionan en el runtime, que registra eventos/snapshot para conciliación posterior.

Orden de programación: confirmación de servidor → comando nativo persistido → AlarmManager → resultado nativo con revisión → proyección SQLite → acuse en outbox. Si la app muere entre pasos, el snapshot nativo permite completar proyección/acuse. SQLite no puede sobrescribir un tombstone nativo con una proyección vieja. Cancelar localmente siempre llega primero al runtime; una sincronización posterior no lo reactiva sin nueva decisión válida. Se prueban fallos entre cada frontera. No se afirma atomicidad entre cuatro sistemas.

La modalidad estándar usa un adaptador de `expo-notifications` y conserva su identificador de programación en SQLite; se concilia con los avisos registrados que expone esa API. La modalidad sonora usa exclusivamente el módulo nativo. Una misma ocurrencia no se programa en ambos mecanismos. El acuse identifica modalidad y mecanismo, y cambiar modalidad exige cancelar la programación anterior. La UI no presenta ambas modalidades con las mismas garantías.

El handler de mensajes de RNFirebase se registra antes de la entrada de Expo Router. Su ejecución background/Headless JS es limitada y oportunista; no depende del árbol React ni es condición para que suene una alarma ya programada. Un push visible de propuesta no se vuelve a mostrar manualmente si el sistema ya lo presentó.

El spike comprueba la convivencia de RNFirebase Messaging y expo-notifications en el manifiesto combinado y en la recepción real; asignar responsabilidades en TypeScript no prueba compatibilidad nativa. Si hay conflicto, se resolverá la presentación local mediante el adaptador nativo, manteniendo una única ruta de recepción FCM y registrando el cambio de decisión.

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

FCM, Doze, ahorro de batería, fabricante y permisos limitan entrega y ejecución. El spike debe validar cada modalidad en development build; si la vía nativa falla, la alarma sonora P0 sigue bloqueada y se recortan módulos secundarios. No se presenta una notificación como sustitución completada. No se garantiza sonar con dispositivo apagado, tras una detención forzada ni ignorando modo silencio/no molestar. Una pantalla a pantalla completa solo se implementa cuando los permisos, elegibilidad y restricciones de plataforma lo permitan; la demo no debe depender de eludirlos.

La alarma sonora requiere concretar recepción, audio, duración máxima, parada y notificación visible en la prueba de viabilidad del día 1. Elegir los componentes Android permitidos según SDK objetivo. Un `BroadcastReceiver` no debe ejecutar audio indefinidamente. Si hace falta un foreground service, debe cumplir tipo, permisos y restricciones de inicio; no se selecciona un tipo arbitrario solo para superar una excepción.

## 7. Seguridad, coste y observabilidad

- Functions con Admin SDK debe validar autorización explícitamente: sus privilegios no están limitados por Firestore Rules. Las reglas impiden escrituras directas a estados, acuses y operaciones protegidas.
- Auth identifica usuarios; App Check se añade como defensa frente a clientes no autorizados, sin tratarlo como sustituto de Auth o de permisos de grupo. En local se documenta su configuración de depuración.
- Limitar frecuencia de propuestas por usuario/grupo, tamaño del texto y cantidad de destinatarios. La preferencia de silenciar propuestas no revoca avisos ya aceptados.
- FCM sin texto privado innecesario; claves de proveedor, cuentas de servicio y credenciales de despliegue fuera del repo. Configuración de cliente no se usa como secreto ni como control de acceso.
- Logs estructurados con `operationId`, entidad, versión, resultado y duración; evitar texto de alarmas, tokens y datos personales. Correlación local/servidor para diagnosticar duplicados.
- Listeners solo para pantallas activas y consultas acotadas; desconectar al cambiar de cuenta/grupo. Widget usa una proyección preparada por la app o el adaptador permitido por expo-widgets; no asume acceso a SQLite/React desde su runtime aislado ni consulta toda la base en cada render. Si una acción requiere JS vivo, abre una ruta explícita y no promete ejecución autónoma.
- Usar Emulator Suite para integración local; separar datos/proyecto de demo de entornos posteriores. Verificar facturación y cuotas de Functions/FCM/Firestore antes de desplegar; no asumir coste cero.
- Registrar antes de demo: latencia propuesta→recepción, aceptación→programación, número de duplicados, error horario local y resultados por dispositivo/API. Tamaño y rendimiento se miden sobre una build de release.

## 8. Estrategia de pruebas

El enfoque de desarrollo guiado por pruebas se reserva para consentimiento, versiones, idempotencia, tiempo y cálculos. No escribir tests que repliquen literalmente cada función ni snapshots de pantallas sin comportamiento relevante.

| Nivel | Casos imprescindibles | Evidencia |
|---|---|---|
| Unidad TypeScript/dominio | Transiciones permitidas, consentimiento por versión, rechazo no altera tarea, otra hora no altera vencimiento, duplicados, recurrencia/DST, tombstones offline. | Tests con Clock y runtime falsos; sin esperar horas reales. |
| Unidad TypeScript/backend | Validación, pertenencia, permisos de creador/destinatario, control de versión, idempotencia/payload diferente, caducidad. | Resultados deterministas y errores de dominio. |
| Contrato | Fixtures válidos/incorrectos, mismos enum/tiempos, campos opcionales, errores. | TypeScript y Kotlin consumen los mismos ejemplos JSON. |
| Firebase Emulator Suite | Reglas deniegan usuario externo y escritura directa, tokens privados, invitaciones; handlers rechazan identidad/grupo falso; carreras de aceptar/editar y entrega duplicada. | Suite automatizada con dos usuarios y un tercero sin acceso. |
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
9. Función con reintentos: mismo resultado sin duplicar propuesta, evento ni decisión.
10. Usuario ajeno: no lee documentos privados ni puede mutar un grupo pasando su ID.
11. Reinicio, fecha pasada y cambio estacional: ninguna alarma antigua se dispara inesperadamente; próximas ocurrencias se recalculan conforme al contrato.

CI propuesta cuando exista el código: TypeScript estricto, lint, tests dominio/UI, tests backend/reglas con emuladores y fixtures compartidos; build de development/release Android y tests Kotlin del módulo local cuando exista. Añadir comprobaciones de configuración Expo y lockfile reproducible. Instrumentación y pruebas físicas se documentan aparte; pasar unit tests no valida alarmas en segundo plano.

## 9. Módulos P1: contratos antes de ampliar

- **IA:** petición → datos autorizados del grupo → propuesta estructurada → validación determinista → revisión humana. Timeout/fallo deja operativo el flujo manual. Un texto del usuario o una tarea no puede añadir herramientas o permisos al agente.
- **Gastos:** cantidades enteras en céntimos, moneda única del grupo, participaciones cuya suma es el total; céntimos sobrantes asignados en orden estable de UID. Liquidaciones no son gastos nuevos.
- **Huchas:** libro de movimientos idempotentes; aportaciones previstas no aumentan saldo; aportación realizada no consume presupuesto; compra desde hucha consume presupuesto y saldo sin crear de nuevo una deuda personal.
- **Rotaciones/intercambios:** propuesta con versión de origen y aceptaciones de afectados; el responsable actual se conserva hasta aprobar. El modelo no define equidad unilateralmente.

No crear estos módulos en paralelo a costa de la aceptación, persistencia y pruebas del P0. Las decisiones de contabilidad necesitan tests específicos cuando se implementen.

## 10. Decisiones que deben cerrarse en el día 1

| Decisión pendiente | Owner y condición para cerrar |
|---|---|
| Expo SDK, RNFirebase, plugins, `minSdk`/`targetSdk`, toolchain | P1 y P6; development build instalada en teléfonos disponibles y requisitos verificados. |
| Módulo nativo, audio/presentación, permisos y pantalla completa | P4; spike real con app cerrada/pantalla bloqueada y documentación de restricciones. |
| Método Auth y distribución de invitaciones | P2 y P3; priorizar correo/contraseña o método ya configurado, con flujo reproducible. |
| Región Firebase, facturación y entorno demo | P3 y P6; acceso del equipo y presupuesto explícito antes de desplegar recursos. |
| Política DST propuesta y límites de snooze | P1, P4 y producto; fixture aceptado y texto visible al usuario. |
| Nivel P1 que entra realmente | P6 con el equipo al cierre del día 2; solo si pasa el recorrido P0 y queda capacidad de verificación. |

Cada decisión se registra como ADR breve con contexto, elección, alternativa y consecuencia. Si cambia este contrato, se actualizan fixtures y consumidores en el mismo cambio o con una transición compatible; un documento no puede afirmar una garantía que la demo no verifica.
