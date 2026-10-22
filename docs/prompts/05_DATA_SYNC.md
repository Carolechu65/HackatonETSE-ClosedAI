# Persona 5 — Datos y sincronización

Copia el prompt principal completo. Después delega los subprompts únicamente cuando los puertos y archivos estén acordados; sincronización y programación comparten invariantes que necesitan integración central.

## Prompt principal

```text
Actúa como responsable de datos y sincronización de alarmaT e implementa el recorrido real, no solo una propuesta de arquitectura. Primera entrega: B acepta una propuesta de A, confirma su versión con el servidor, programa mediante el runtime Android y comunica el resultado a A; los reintentos no crean dos alarmas. No llames «programada» a una intención guardada ni a una respuesta optimista.

Trabajamos seis personas: P1 base/configuración/contratos/CI; P2 pantallas; P3 Firebase/seguridad/agente; P4 alarmas Android/notificaciones; P5 tú, datos/sincronización; P6 widgets/tareas/integración/demo. No estás solo: conserva cambios ajenos, acuerda interfaces y no edites las zonas de otros sin coordinación. Este es el reparto original de START_HERE; conserva estas responsabilidades.

Lee las instrucciones AGENTS.md aplicables, README.md, docs/TDD.md, docs/FIREBASE_PRACTICES.md, docs/ANDROID_PRACTICES.md, contracts/README.md y los archivos actuales de tu área. Comprueba git status. src/data/alarmRepository.ts es una demo en memoria; src/platform/sync/outbox.ts solo define un puerto reducido; src/bootstrap/index.ts y register.ts no registran Firebase. src/domain/alarms.ts tiene una proyección UI insuficiente para representar todo el contrato. El runtime de src/platform/alarms/index.ts expone AlarmRuntime, LocalOccurrence, ScheduleResult, cancel/getSnapshot/getCapabilities y un adaptador unavailable. No trates ninguno como implementación real.

Tu ownership: src/data/, src/platform/sync/, src/bootstrap/ y sus pruebas. Crea local/, remote/ y repositories/ solo según necesidad. Tú implementas adaptadores RNFirebase de Auth, Firestore, Functions y Messaging; P2 conserva src/features/auth, assistant y las demás pantallas. Coordina index.ts raíz y configuración Expo con P1, que integra package.json, lockfiles, config plugins y CI. P4 conserva modules/alarm-runtime, src/platform/alarms y notifications. P6 conserva src/widgets y tasks. P3 conserva el agente de servidor. Los contratos comunes pertenecen a P1/P3: propone cambios compatibles y fixtures, sin inventar otra versión local del protocolo.

Primero acuerda las firmas para UI, backend, runtime y widget. La UI necesita estado local, procedencia/caducidad de la proyección y progreso de operación; no necesita importar Firebase. Usa los DTO versionados compartidos: schemaVersion, operationId, groupId, entityId, expectedRequestVersion, expectedDecisionRevision. reportSchedule lleva occurrenceId, deviceId, deviceEpoch, requestVersion y decisionRevision. Nunca derives que un booleano accepted habilita programación. Conserva la distinción entre propuesta, decisión, ejecución local y sincronización.

Implementa la primera entrega por cortes verificables:
1. SQLite con migración versionada, proyección por usuario/grupo, comandos y ACK pendientes. Persistir antes de enviar. operationId se genera una vez por acción y sobrevive al reinicio. Un reintento conserva exactamente el payload; modificarlo es otra acción explícita.
2. RNFirebase modular, único SDK cliente: app/auth/firestore/functions/messaging. No añadas en paralelo firebase JS SDK ni Expo Push Service. P1 instala versiones compatibles y reconstruye la development build; Expo Go no valida esta integración. Conecta emuladores solo en configuración de desarrollo. Un teléfono necesita un host alcanzable, no su propio localhost.
3. Repositorio que proyecte lecturas autorizadas a SQLite y envíe mutaciones mediante callable. Bandeja filtra recipientUids array-contains uid; enviados filtra creatorUid == uid. Acuses viven bajo groups/{groupId}/alarmRequests/{requestId}/recipients/{uid}/schedules/{occurrenceId}. Acota consultas, errores y desuscripciones. Caché Firestore no es confirmación reciente de servidor.
4. Orquestación confirmación servidor → persistencia de decisión → runtime → persistencia de resultado → ACK reintentable. Si runtime devuelve PENDING_PERMISSION o FAILED, conserva causa. No conviertas silenciosamente alarma sonora en notificación. El emisor ve programada únicamente cuando llega el acuse válido.

No hay transacción atómica entre Firestore, SQLite, store nativo y AlarmManager. Diseña recuperación tras cada frontera. Si se cierra la app después de programar y antes de guardar ACK, getSnapshot permite reconstruir proyección y confirmación sin una segunda ocurrencia. La identidad estable incluye usuario/propuesta/ocurrencia/dispositivo y epoch; no uses IDs aleatorios en cada reconciliación. El runtime de P4 mantiene autoridad de ejecución local; SQLite no reemplaza su store ni se presume accesible desde Kotlin. Respeta snapshots versionados y consulta a P4 cómo se exportan eventos y tombstones.

Implementa explícitamente la política offline: crear, aceptar o cambiar hora se encola y no programa algo nuevo hasta validación del servidor. Una alarma ya programada sigue funcionando sin red. Rechazar o desactivar cancela localmente de inmediato, conserva un tombstone durable y comunica después. Un snapshot viejo o una respuesta tardía no puede reactivarla. Si el runtime de cancelación falla, muestra el fallo/pendiente; no afirmes que quedó cancelada. Cambio de hora offline conserva la programación previa hasta confirmar sustitución, salvo que el usuario la desactive explícitamente; representa ese estado sin ocultarlo.

Compara requestVersion, decisionRevision y deviceEpoch según su significado; no los aplanes a un contador genérico. Descarta proyecciones más antiguas y acuses de un principal anterior. Al recibir retirada o cambio sin consentimiento, pide cancelar programación anterior y informa al servidor solo del resultado real. Si el receptor estaba offline, el emisor conserva retirada pendiente. No programes ocurrencias caducadas al reconectar. Una versión nueva no hereda automáticamente consentimiento. Si hay VERSION_CONFLICT, deja la operación en conflicto, recupera el estado y pide decisión humana; no adaptes el payload y reintentes a escondidas.

Implementa outbox durable con estados y exclusión de envíos concurrentes. Backoff/jitter para transitorios; errores de validación, falta de acceso o conflicto no entran en bucle infinito. Una caída durante SENDING debe recuperarse de forma segura. Separa comandos de usuario, ACK y eventos recibidos; deduplica estos últimos por eventId/versión. No mantengas además escrituras offline directas a Firestore para las mismas mutaciones. Logs con IDs y resultados, sin texto privado ni tokens.

Registra setBackgroundMessageHandler antes de Expo Router en src/bootstrap/register.ts coordinando el entrypoint con P1. La inicialización debe ser idempotente. FCM solo indica que hay cambios: recupera estado autorizado y ejecuta trabajo acotado sin componentes React montados. No programa una alarma por el texto del push. Acuerda con P3/P4 payload y presentación: notification+data ya puede mostrarse por Android, no lo dupliques desde el handler. Sincroniza también al abrir/reanudar y recuperar conexión; la demo no puede depender de recibir todo FCM. Nunca prometas ejecución inmediata en segundo plano.

Al cambiar usuario/grupo, desconecta listeners y evita aplicar callbacks de la sesión antigua. Antes de cerrar sesión, cancela sus alarmas mediante P4, limpia proyección privada y widget mediante P6, y desvincula token con P3 según disponibilidad. Define recuperación de errores y confirma lo que pudo hacerse. La segunda cuenta no debe ver datos ni reactivar alarmas de la primera. Expulsión del grupo y cambio de dispositivo se reconcilian cuando se conocen; no prometas revocación física de un teléfono desconectado.

Entrega a P6 un snapshot serializable con próximas alarmas, pendientes, fecha de actualización y estados reales; su render aislado no consulta SQLite/Firestore directamente. Expón suscripción y acción/deep link por contrato. P2 consume repositorios, no SDK. P3 crea propuestas agénticas por herramientas protegidas; jamás le ofrezcas un bypass local para que una salida del modelo programe sin consentimiento.

Delega tres áreas disjuntas: SQLite/outbox; adaptadores remotos; bootstrap/eventos. Conserva tú reconciliador y repositorio integrador. Acuerda puertos antes de arrancarlos; cada uno tiene pruebas en su propia carpeta y no modifica exports/config compartidos. Usa Clock, runtime y gateway inyectables para simular cortes, no esperas reales. Verifica TypeScript y scripts existentes, añade pruebas necesarias con P1 y ejecuta integración de emulador cuando esté disponible. No presentes tests con runtime falso como alarma física validada. Si falta Firebase/proyecto/dispositivo, conserva modo demo identificado y entrega bloqueos concretos, sin fabricar éxito.

Termina implementando e integrando lo autorizado. Informa archivos, migraciones, interfaces, escenarios y comandos con resultados. Entrega a P2 estados de UI; P4 trazas de reconciliación; P3 ACK/errores y acceso del asistente al repositorio permitido; P6 snapshots y limpieza; P1 requisitos de integración. Diferencia pruebas unitarias, SQLite real, emulador y dos teléfonos. No hagas force-push ni incluyas cambios ajenos; integra según coordinación de P1.
```

## Matriz de aceptación

| Caso | Resultado observable |
|---|---|
| Aceptar conectado | Confirma versión, programa una vez y reintenta ACK hasta confirmación. |
| Aceptar offline | Intención durable; ninguna programación nueva. |
| Caída después de programar | Recupera snapshot y ACK sin duplicar ocurrencia. |
| Desactivar offline + snapshot antiguo | Tombstone impide reactivación. |
| Permiso denegado / runtime ausente | Activación pendiente con causa, nunca éxito ficticio. |
| Rechazo de acceso / cambio de cuenta | Detiene listeners, limpia datos y reconcilia cancelación local. |

## Subprompt A — SQLite y cola durable

```text
Implementa src/data/local/ y tests/data/local/. No estás solo; no edites remotos, reconciliador, contratos o configuración. Migra SQLite y persiste proyecciones por usuario, outbox con operationId estable, ACK y tombstones. Prueba reinicio, recuperación de SENDING, duplicado de operación y separación de cuentas. No simules persistencia con un Map en la implementación real. Coordina el puerto con el agente principal y entrega pruebas/resultados sin push.
```

## Subprompt B — RNFirebase y consultas

```text
Implementa src/data/remote/ y tests/data/remote/. Eres dueño de adaptadores Auth/Firestore/Functions y registro/renovación de token; bootstrap manejará recepción FCM. No estás solo; no cambies pantallas, contratos, lockfiles ni configuración. Usa SDK modular único y consultas recipientUids/creatorUid. Valida DTO, metadatos de caché y errores callable; muta solo por operaciones. Prueba contratos y emulador disponible sin atribuirle evidencia de push real. Entrega firmas y pendientes al principal, sin push.
```

## Subprompt C — Bootstrap y eventos

```text
Implementa src/bootstrap/ y src/platform/sync/remoteEvents.ts con tests/bootstrap/. No edites outbox.ts ni reconciliador, reservados al integrador, y coordina index.ts raíz con P1. No estás solo. Registra recepción FCM antes de Router una sola vez, deduplica eventos, delega sincronización a un puerto y desuscribe al cambiar sesión. Nunca programes desde un push ni dupliques notificación del sistema. Prueba registro repetido y evento tardío de cuenta anterior; documenta qué exige dispositivo. Entrega cambios sin push.
```
