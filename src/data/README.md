# P5 · Datos y sincronización

Implementación de SQLite local, outbox, HTTP/SecureStore, repositorio y reconciliación con los puertos de P4. **La pantalla existente sigue usando la demo en memoria** de `alarmRepository.ts`: no hay URL desplegada, wrappers HTTP de P3 ni runtime Android operativo en este checkout. Los tests de P5 usan SQLite real y dobles explícitos de HTTP/runtime; no acreditan sonido ni dos teléfonos.

## Entradas y composición

- `client.ts`: `createDataClient` compone sesión, cliente HTTPS y repositorio; inyectable en pruebas.
- `mobile.ts`: `openMobileDataClient` abre una conexión dedicada `expo-sqlite` y usa SecureStore.
- `../bootstrap/startMobile.ts`: `startMobileServices` inicia una única composición móvil y listeners reales. Su importación no arranca una sesión ni solicita permisos.
- `index.ts`: exportaciones sin importar módulos nativos, para consumidores y pruebas.
- `repositories/alarmRepository.ts`: `PersistentAlarmRepository`, compatible con el puerto `AlarmRepository` de P1; la UI nueva debe consumir también los estados completos.
- `remote/gateway.ts`: `HttpWireCodec` obligatorio para decodificar los wrappers de sesión, `/me` y `/sync` que P1/P3 aún deben fijar. **No se ha inventado un protocolo HTTP paralelo**. Sus resultados normalizados se vuelven a validar contra los validadores v1 compartidos.

Integración P1/P2 (los argumentos deben proceder de los contratos y configuración reales, no de los fixtures de tests):

```ts
import { startConfiguredMobileServices } from '../bootstrap/index.ts';

const client = await startConfiguredMobileServices({
  baseUrl,             // origen HTTPS alcanzable por el móvil; sin credenciales
  codec,               // HttpWireCodec implementado a partir de los wrappers acordados con P3
  deviceId,            // identidad de instalación registrada en P3, estable entre reinicios
  runtime,             // AlarmRuntime de P4
  notificationRuntime, // scheduler NOTIFICATION separado de P4; opcional mientras falte
  publishWidget,       // P6: publicar snapshot serializable o null al retirar sesión
  enablePush: false,   // no hace falta push para sincronización en foreground
});

await client.login(credentials); // register también disponible; no persiste contraseñas
const repository = client.getRepository(); // null sin sesión utilizable
const unsubscribe = repository?.subscribe(snapshot => render(snapshot));
await repository?.enqueue(command); // durable; operationId generado UNA vez por acción
await client.sync.reconcile();
const { remoteRevoked } = await client.logout();
```

`client.subscribe` devuelve sesión pública, cuenta propietaria de los datos locales, limpieza pendiente y disponibilidad del repositorio. `sessionEvents` y `sync` son los puertos usados por bootstrap. No expone bearer ni SQL a pantallas. Al cambiar la disponibilidad de sesión, P2 debe volver a obtener el repositorio y desuscribir la instancia anterior.

## Contratos para P2 y P6

`repository.enqueue(command)` guarda antes de enviar y devuelve `PendingOperation`; no afirma éxito remoto. `submit(command)` mantiene la firma de P1: devuelve únicamente un `OperationReceipt` real. Si quedó encolado lanza `PendingOperationError` con `operationId`; **no volver a generar el ID** para reintentarlo.

`subscribe` / `getSnapshot` exponen `DataSnapshot`: origen `sqlite`, fecha local de generación, última consulta confirmada, indicador `stale`, operaciones y `AlarmView[]`. Cada vista conserva DTO de propuesta/destinatario/principal, decisión confirmada, decisión pendiente, ejecución local, motivo, hora efectiva y deep link. Una propuesta enviada a varios miembros conserva una proyección por destinatario. `subscribeInbox` sólo es el adaptador reducido de compatibilidad; no sustituye los estados completos de la UI nueva.

`widgetSnapshot` devuelve `PersistedWidgetSnapshot` v1, separado por usuario y grupo: próxima ocurrencia futura realmente `SCHEDULED` con versiones/dispositivo vigentes, emisor, enlace, acuse pendiente, propuestas y activaciones pendientes, fecha y caducidad de la proyección. Se guarda en SQLite antes de llamar a `publishWidget`; P6 publica esos datos mediante la API de widgets. Su render no consulta la base ni HTTP. `null` limpia la proyección publicada; una publicación antigua se drena antes del cierre. Abrir `alarmat://alarm/<requestId>` no acepta nada.

## Persistencia y recuperación

`local/database.ts` aplica migraciones transaccionales y rechaza versiones de esquema futuras. Usa conexión exclusiva del subsistema, WAL, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=FULL` y borrado seguro SQLite. Ninguna transacción contiene HTTP ni llamadas nativas.

| Migración | Tablas |
|---|---|
| 1 | `projections` por usuario/grupo/propuesta/destinatario; `outbox`; `local_schedules`; `cancellation_barriers`; `sync_state`; `received_events`; `revoked_scopes`; `widget_snapshots`; `cleanup_pending`. |
| 2 | `account_owner`: conserva la identidad de la cuenta local tras un 401 y reinicio, incluso cuando SecureStore ya no contiene el bearer. |

Una migración antigua con varias cuentas ambiguas se rechaza para no atribuir datos a la cuenta equivocada. No hay migración desde servidor ni acceso al archivo SQLite del VPS.

- La única outbox distingue `COMMAND` y `ACK`, persiste el payload canónico y rechaza reutilizar un ID con otro contenido.
- Reclamo transaccional de `SENDING`, un envío concurrente por worker y orden por entidad. Tras reiniciar se recupera `SENDING` como `QUEUED` con el mismo ID/payload.
- Backoff con jitter, `Retry-After` y máximo de ocho intentos automáticos. Conflicto, denegación y validación no se reintentan automáticamente ni se reescribe el payload. `repository.retryOperation(operationId)` permite reanudar explícitamente un transitorio agotado, conservando el ID y el payload; no admite conflictos ni acuses obsoletos.
- Página, cursor opaco, deduplicación y revocaciones se aplican en una transacción. Se limitan 200 eventos por página, 20 páginas por reconciliación y 50 envíos por pasada de outbox. Si queda paginación, se conserva el cursor y no se programa algo nuevo hasta completar la consulta.
- No retroceden `requestVersion`, `decisionRevision`, `deviceEpoch` ni los timestamps de acuses. Un acuse atrasado no devuelve `SCHEDULED` a una ocurrencia cancelada. No se reinicia silenciosamente un cursor inválido: P3 debe fijar el contrato de resincronización autorizada.
- Identidad de ocurrencia compartida de P1, snapshot revisionado de P4 y estado local `SCHEDULING` antes de llamar al runtime. Resultado y ACK se guardan juntos. Una caída después del commit nativo se recupera consultando su snapshot, sin crear otra ocurrencia.

## Consentimiento, offline y limpieza

Aceptar/crear/cambiar hora sin red sólo encola. No se programa una nueva aceptación hasta recuperar confirmación del servidor. Un cambio de hora offline mantiene la programación previa. Una ocurrencia pasada no se activa al reconectar; `SERIES` usa el cálculo semanal compartido para seleccionar la próxima futura. El runtime P4 sigue siendo responsable de materializar las siguientes con JS cerrado.

Rechazar/desactivar guarda una barrera durable en la misma transacción que la acción y cancela localmente sin esperar a HTTP. La barrera sobrevive a snapshots viejos y conflictos. Sólo una aceptación local explícita posterior, confirmada con las nuevas revisiones, puede retirarla. Una cancelación que devuelve `CANCEL_PENDING` o lanza error sigue pendiente, bloquea el reemplazo y nunca se presenta como cancelada.

Se separan `ALARM_RUNTIME` y `EXPO_NOTIFICATIONS`; si falta el adaptador correspondiente se informa fallo. No hay degradación automática de alarma a notificación. Se preservan los motivos de permisos/errores del runtime y se vuelven a consultar capacidades; un snapshot viejo no acredita permisos vigentes.

Un 401 aborta la sesión y conserva las operaciones de esa cuenta sin confirmarlas. La identidad de cuenta y el marcador de limpieza se conservan hasta borrar SecureStore, también ante caída entre fronteras. Logout desactiva repositorios/listeners, drena operaciones/publicaciones en vuelo, cancela nativo, limpia widget y datos privados y revoca remotamente cuando es posible. Si falla una cancelación, `cleanup_pending` sobrevive al reinicio y bloquea otra cuenta. `remoteRevoked: false` significa que la revocación remota no se pudo confirmar; no se presenta como hecha. El siguiente login de otra cuenta exige terminar primero la limpieza anterior.

## Bootstrap, red y push

`../bootstrap/controller.ts` registra fuentes una sola vez, sincroniza al abrir/reanudar/recuperar red y hace hasta diez polls de 30 segundos por ventana foreground. Suspende timers en background, evita solapamientos y rechaza callbacks de sesiones anteriores. El transporte HTTPS limita tiempo, tamaño y endpoints y no mantiene una segunda cola de mutaciones.

`expoSources.ts` usa AppState, expo-network y, si se habilita, listeners de expo-notifications. Un push sólo provoca lectura autorizada; no contiene comandos de programación ni se presenta una notificación adicional. **Registro/renovación del token Expo y desvinculación en P3 pendientes de su contrato de dispositivos**, aún no existe el DTO/endpoint aprobado. No se inventan `registerDevice` ni permisos silenciosos. Sin credenciales FCM/Expo y teléfono no hay evidencia de entrega remota. No se garantiza sincronización con la app cerrada.

## Verificación y entrega por responsable

Con Node 22 de `.nvmrc`:

```sh
npm ci
npm run check
npm run export:android
```

`npm test` enumera explícitamente todas las suites `tests/**/*.test.ts` mediante `scripts/test.mjs`; el argumento antiguo `--test tests` falla con Node 22. Los tests P5 están en `tests/data/` y `tests/bootstrap/` y ejecutan las mismas migraciones/SQL de producción sobre archivos temporales de `node:sqlite`. Runtime y red son dobles inyectados, identificados como pruebas. `functions/` sigue siendo legado; su compilación no prueba una API SQL.

| Responsable | Entrega y dependencia real |
|---|---|
| P1 | Dependencias Expo 58/lockfile/plugins, runner Node22 y factory de composición. Reconstruir development build tras paquetes nativos. |
| P2 | DataClient + snapshot completo, cola durable y errores diferenciados; conectar pantallas reales de acceso/grupo/propuestas. La demo anterior sigue identificada. |
| P3 | `POST /v1/operations/{name}` y DTO v1 intactos. Faltan URL/API real, wrappers auth/feed/list/detail, resincronización de cursor y contrato dispositivo/push. La implementación no adivina esos formatos. |
| P4 | Reconciliador, motivos de fallo, ACK, barreras y consumo de snapshot/capacidades. Falta runtime real y scheduler estándar compatible; el puerto actual no incluye eventos ricos de snooze/recurrencia ni persistencia de tokens de notificación. |
| P6 | Snapshot persistido y publisher/limpieza, pruebas de regresión y deep links. Falta publicación Android real y validación en dos móviles. |

La aceptación física pendiente sigue siendo A propone → B acepta → confirma versión → programa → ACK a A → widget → sonar/detener con proceso cerrado. También API con SQLite temporal y autorización A/B/C, build con nuevas dependencias e instalación física. Ningún fixture sustituye esa evidencia.

Referencias de implementación contrastadas: [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/), [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) y [Network](https://docs.expo.dev/versions/latest/sdk/network/).
