# Persona 4 — Alarmas Android

Copia el prompt principal completo. Conservamos el reparto original de START_HERE: persona 4 implementa el runtime Android. La primera demostración física es una dependencia crítica del proyecto.

## Prompt principal

```text
Actúa como responsable Android de alarmaT. Implementa una alarma local real que suene en un dispositivo con el proceso de la app cerrado normalmente, se pueda detener y posponer y conserve su estado. No entregues solo arquitectura, temporizadores JS, una notificación de ejemplo ni una promesa de funcionamiento. Si falta un dispositivo o SDK, avanza código y pruebas disponibles y declara qué evidencia física queda pendiente.

Primero revisa git status e instrucciones AGENTS.md aplicables. Lee README.md, CONTRIBUTING.md, docs/TDD.md, docs/ANDROID_PRACTICES.md, docs/START_HERE.md y docs/TEAM_PLAN.md. Después inspecciona modules/alarm-runtime/README.md, expo-module.config.json, Gradle/manifiesto disponibles, AlarmRuntimeModule.kt, src/platform/alarms/index.ts, src/platform/notifications/index.ts y app.config.ts. El scaffold actual devuelve capacidades indisponibles y E_NOT_IMPLEMENTED: no presupongas autolinking, permisos, recepción ni sonido ya resueltos.

Eres propietario de modules/alarm-runtime/, src/platform/alarms/ y src/platform/notifications/. Persona 1 integra configuración raíz, dependencias cliente, app.config.ts, Router y CI; solicita cambios con un diff o especificación concreta y evita escribir su lockfile a la vez. Persona 2 implementa pantallas; persona 3 controla API HTTPS, SQLite del VPS, seguridad y agente; persona 5 datos/sincronización/bootstrap; persona 6 widgets, tareas e integración/demo. No implementes un segundo cliente de push, una segunda cola remota ni pantallas ajenas. No estamos solos: conserva cambios de otros y coordina cualquier modificación de contrato compartido.

Usa subagentes con zonas exclusivas: A almacén/modelo nativo, B presentación sonora/acciones, C notificaciones estándar. Tú mantienes puente Expo, adaptación TS, integración AlarmManager y receptores de recuperación. Pacta interfaces antes de paralelizar. Los subagentes no editan configuración compartida ni publican commits por separado. Si no puedes delegar, implementa las mismas tareas secuencialmente.

Primera entrega vertical: una development build carga el módulo, recibe una ocurrencia previamente consentida, persiste su identidad, programa Android, devuelve un resultado real, suena a la hora elegida sin JS vivo y permite detenerla. Usa un harness de prueba claramente identificado si el backend aún no está listo. No presentes ese harness como prueba de consentimiento remoto. Coordina con persona 1 dónde se aloja; no añadas botones de depuración a producción sin control explícito.

Respeta las interfaces vigentes OccurrenceKey, LocalOccurrence, ScheduleResult, CancelResult, AlarmCapabilities y RuntimeSnapshot. Identidad estable: usuario, petición, ocurrencia, dispositivo y deviceEpoch; revisiones de petición y decisión deben viajar con el comando. Las ampliaciones necesarias —por ejemplo detener, posponer o registrar resultados— se acuerdan con persona 5 y persona 1 antes de cambiar consumidores. Devuelve razones tipadas y comprensibles. No uses un booleano genérico para mezclar permiso, programación y ejecución.

El módulo nativo tiene un registro privado durable como autoridad de ejecución local. No supongas que SQLite JS puede abrirse desde un receptor Android, ni dependas de arrancar React para leer una alarma. Persona 5 refleja snapshots revisionados en su propia proyección. Persiste intención antes de programar y resultado después; recupera interrupciones entre ambos mediante reconciliación idempotente. Rechaza ocurrencias vencidas, versiones antiguas y comandos invalidados por cancelaciones conocidas. Mantén tombstones suficientes para que un reintento no resucite una alarma cancelada.

El runtime no puede certificar por sí solo la identidad autenticada por el servidor de quien aceptó: recibe comandos de la capa de sincronización tras confirmación del servidor, valida integridad y revisiones locales y nunca convierte un push en consentimiento. Un receptor local verifica que la ocurrencia disparada siga vigente en el registro antes de presentar sonido. Defiende los componentes Android ante entradas externas y usa exposición/exportación y PendingIntent adecuados para la versión objetivo.

Implementa capacidades y permisos por separado. Acceso a alarmas exactas, permiso de notificaciones y capacidad de presentación/sonido tienen requisitos distintos. Verifica las APIs oficiales aplicables al target SDK real, sin copiar permisos o foreground service types por intuición. AlarmManager programa una entrega: no reproduce audio automáticamente. Elige y valida el mecanismo de sonido y servicio/presentación, su ciclo de vida, restricciones de inicio en segundo plano y acciones de usuario. Una pantalla de alarma a pantalla completa tiene requisitos propios y no se presupone disponible.

Si faltan permisos devuelve PENDING_PERMISSION; no reemplaces silenciosamente la alarma audible aceptada por otro modo. Solicitar permiso requiere UI contextual coordinada con persona 2. No abras ajustes desde un receptor de background. Detener libera recursos y deja un registro; posponer crea una nueva programación con identidad/revisión coherente y duración explícita. Ambas acciones funcionan sin red y no completan una tarea ni cambian su responsable.

Integra el modo NOTIFICATION mediante src/platform/notifications y la API compatible elegida. Acuerda con persona 5 quién recibe la pista de push y quién presenta el aviso para evitar duplicados. Una notificación invitando a responder no es la alarma aceptada. Cuando el usuario rechaza o cancela, retirar la propuesta visible no sustituye cancelar una ocurrencia ya programada. Devuelve los resultados adecuados para que sincronización pueda confirmarlos al emisor.

Implementa la identidad de PendingIntent de modo que programar dos veces la misma ocurrencia actualice o conserve una sola programación. No confíes únicamente en un hash susceptible de colisiones sin estrategia de resolución. Cancelar debe apuntar al mismo identificador y dejar evidencia local. Android no ofrece una consulta universal que pruebe todas las alarmas registradas: una reconciliación segura compara intención y registro y vuelve a programar de forma idempotente cuando procede.

Después del aviso puntual, cubre recuperación tras reinicio y cambios de hora/zona según el TDD. Solo reprograma ocurrencias futuras con consentimiento vigente; no hagas sonar inmediatamente las antiguas. Para repetición semanal conserva zona, configuración consentida y próxima ocurrencia; aplica los fixtures comunes de horario estacional. No introduzcas un segundo cálculo temporal incompatible con el backend. Documenta por separado qué queda pendiente si el primer incremento aún no tiene recurrencia.

Verifica el registro del módulo y que permisos/componentes sobreviven regeneración nativa mediante manifiesto del módulo/config plugin acordado con persona 1. Los archivos generados por prebuild no son la única fuente de configuración. Reconstruye la development build al cambiar Kotlin o plugins; recargar JS no basta.

Pruebas prioritarias: duplicado no programa dos veces; cancelación seguida de reintento viejo no resucita; versión obsoleta falla; permiso denegado no reporta SCHEDULED; ocurrencia vencida no suena al recuperarse; detener libera audio; posponer mantiene independencia de la tarea. Usa pruebas puras para reglas y pruebas Android/instrumentación para integración donde aporten evidencia. En dispositivo verifica programar→cerrar proceso normalmente→sonar→detener y repite sin red, con pantalla bloqueada, cancelación, reinicio y restricciones relevantes. Forzar detención desde ajustes es un caso distinto; no prometas que Android lo permite. Registra versión Android, modelo, build, permisos y resultado observado.

Entrega incrementos pequeños: carga del módulo; programación y sonido puntual; acciones/cancelación; recuperación; recurrencia. Para cada uno comunica contrato, archivos, pruebas y límites a personas 1 y 5. SCHEDULED significa programación aceptada localmente, no sonido oído por una persona; FIRED registra ejecución, no tarea hecha. No anuncies éxito por compilar TypeScript o exportar JS. La aceptación de esta área exige evidencia física del recorrido principal y documentación honesta de cualquier bloqueo.
```

## Subagente A — Registro y revisiones nativas

```text
Implementa solo modules/alarm-runtime/android/src/main/java/expo/modules/alarmruntime/store/ y pruebas del almacén/modelo en su zona correspondiente. Acuerda primero DTO y operaciones con el agente principal. No edites puente Expo, receptores, audio, manifiesto ni Gradle. No estás solo: preserva cambios ajenos.

Construye un registro durable privado de ocurrencias, revisiones, intención/resultado y tombstones de cancelación. No importes clientes remotos ni dependas de SQLite JS. Prueba reintento idempotente, comando obsoleto, cancelación que impide resurrección y recuperación de SCHEDULING interrumpido. Si necesitas dependencia, solicítala al principal; no modifiques configuración. Entrega API, semántica transaccional y ejemplos de snapshot para persona 5. Sin commits/push propios.
```

## Subagente B — Sonido y acciones

```text
Tu zona exclusiva es modules/alarm-runtime/android/src/main/java/expo/modules/alarmruntime/presentation/ y sus pruebas. Lee el TDD y el contrato del almacén. No edites store/, puente, receptor de AlarmManager, manifiesto ni configuración compartida. Conserva cambios ajenos.

Implementa presentación sonora con detener y posponer sin JS ni red, usando mecanismos permitidos por el Android objetivo. Verifica requisitos oficiales de servicio, notificación y audio. No asumas que AlarmManager reproduce sonido. Propón al principal componentes/permisos concretos para integrar. Coordina callbacks persistibles y evita completar tareas. Prueba liberación de recursos y acciones repetidas; distingue lo unitario de lo demostrado en teléfono. Entrega evidencia y límites; no publiques commits por separado.
```

## Subagente C — Notificaciones estándar

```text
Implementa exclusivamente src/platform/notifications/ y sus pruebas. Lee NotificationPort y coordina con el principal la modalidad NOTIFICATION. No modifiques src/platform/alarms, src/bootstrap, recepción de push, app.config.ts ni package files. No estás solo y debes preservar los cambios ajenos.

Resuelve permisos, canales, mostrar/retirar propuesta y errores reales mediante las APIs compatibles instaladas o propuestas a persona 1. Identifica avisos de forma estable para evitar duplicados. Abrir el detalle no acepta una alarma. Acuerda con persona 5 quién recibe mensajes y presenta avisos; no añadas otro listener remoto. Si falta una dependencia, informa y avanza contratos/pruebas sin fingir implementación. Entrega ejemplos y casos denegado/duplicado/cancelado al principal, sin commit ni push independiente.
```
