# Runtime Android y notificaciones — P4

Se integra el prototipo de `origin/dAlarmas` con una revisión de cancelación, versiones y recuperación. La ejecución sonora usa Kotlin, AlarmManager y un servicio nativo: no necesita JavaScript ni red a la hora de sonar. **La matriz física sigue pendiente**; compilar no demuestra sonido con la pantalla bloqueada.

## Composición

- La composición real (`src/composition/live.native.ts`) entrega a P5 dos runtimes separados: `createAlarmRuntime()` para `ALARM` y `createNotificationRuntime()` para `NOTIFICATION`. El reconciliador de P5 coordina cancelaciones y cambios de modalidad. Cada acuse conserva su mecanismo real: `ALARM_RUNTIME` o `EXPO_NOTIFICATIONS`.
- `createAlarmRuntime()` expone además controles nativos para el laboratorio: detener, posponer, reconciliar y abrir ajustes. `AlarmRuntime` conserva sus cuatro métodos originales; los controles están en `NativeAlarmControls`.
- `createNotifications()` en `src/platform/notifications/native.ts` presenta/retira propuestas con identificadores estables. No acepta alarmas ni instala listeners remotos. P5 conserva la recepción de push y la recuperación de estado autorizado.
- Los permisos se solicitan exclusivamente desde una acción de UI: `createNotifications().requestPermission()` espera el resultado de Expo; `alarmRuntime.requestExactAlarmPermission()` abre ajustes y **no significa permiso concedido**. Volver a consultar capacidades al reanudar. Los métodos nativos que abren un diálogo devuelven que lo han abierto, no un consentimiento concedido.

## Persistencia y seguridad de ejecución

El store nativo privado usa SharedPreferences con `commit()` comprobado y un lock compartido por todas las instancias del puente, receptores y servicio. Un error de lectura no borra silenciosamente el registro. Se persiste intención antes de programar y resultado después. La recuperación vuelve a programar idempotentemente las futuras; Android no ofrece una consulta universal de sus alarmas registradas.

Una cancelación se persiste **antes** de retirar AlarmManager/audio. Un reintento de la misma decisión no la revive. Una decisión confirmada posterior puede atravesar la barrera únicamente con `decisionRevision` mayor y `requestVersion` no inferior. Se rechazan versiones/epochs antiguos también entre distintas ocurrencias de la misma petición. Una cancelación de identidad nunca conocida conserva una barrera sin versión: el contrato `cancel(key)` no aporta una revisión que permita autorizar su reactivación; se rechaza de forma conservadora.

La identidad usa campos con prefijos de longitud y URI propia por PendingIntent, evitando colisiones por separadores o hashes. Los receptores/componentes internos no están exportados. El receptor acepta únicamente SCHEDULING/SCHEDULED vigentes, reclama FIRED antes de arrancar sonido y rechaza duplicados, fechas futuras y entregas con más de un minuto de retraso. Los reinicios y cambios de reloj nunca hacen sonar inmediatamente las vencidas.

Para alarmas sin tarea, Detener conserva CANCELLED; posponer solo funciona sobre FIRED sin descartar, con duración explícita de 1–60 minutos (acción de notificación: 5 min). La hora aceptada original se conserva para que un replay no deshaga el snooze. Ninguna acción cambia tareas. El servicio libera reproductor/wake lock al finalizar y tiene límite de 10 minutos. Si coinciden alarmas, la más reciente sustituye el sonido anterior; la anterior conserva FIRED y dismissedAt en su snapshot.

## Mecanismos y permisos

El manifiesto versionado del módulo declara `SCHEDULE_EXACT_ALARM`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SYSTEM_EXEMPTED`, `WAKE_LOCK`, `USE_FULL_SCREEN_INTENT` y `VIBRATE`. La app debe conservar autolinking de módulos locales al regenerar Android.

Para Android 14+ se usa `systemExempted`: la documentación contempla apps con acceso exacto que continúan una alarma en un servicio. Para versiones anteriores se usa el servicio foreground sin ese tipo. Se comprueban permiso exacto, notificaciones y canal visible; el acceso a pantalla completa se trata por separado. Si el servicio/audio falla queda FAILED, sin convertir silenciosamente una alarma audible en un recordatorio.

Los recordatorios estándar utilizan exclusivamente `expo-notifications`; un SQLite privado (`alarmat-notification-runtime.db`) conserva intención, revisión y barreras. La reconciliación consulta los identificadores registrados/presentados, repara futuras perdidas y no presume FIRED por haber pasado el reloj. Una notificación cuya presentación no puede observarse queda EXPIRED. La entrega estándar no promete precisión ni sonido sostenido de despertador.

Fuentes oficiales consultadas: [AlarmManager y excepciones de inicio](https://developer.android.com/develop/background-work/services/alarms), [tipos de foreground service](https://developer.android.com/develop/background-work/services/fgs/service-types), [Expo Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/).

## Verificación y límites

- Pruebas TS: `tests/p4-notifications.test.ts` cubre duplicado, permiso denegado, cancelación fallida, tombstones, nuevas revisiones, recuperación y caducidad.
- Pruebas Kotlin: `AlarmPolicyTest` cubre barreras, ejes de versión y disparo de estados terminales/antiguos.
- Compilación Android de esta integración: consultar `BUILD_EVIDENCE.md` al terminar la ejecución; no se heredan como prueba los resultados de otra rama.
- Validación física: pendiente. Seguir `docs/qa/ALARM_RUNTIME.md`, añadiendo cancelación seguida de replay antiguo, canales bloqueados y fallos de audio. La parada ahora conserva CANCELLED (la tabla heredada que menciona FIRED debe interpretarse con este cambio).
- El contrato recibe ocurrencias concretas, con instante UTC y zona. El runtime no inventa recurrencia semanal ni reglas DST: P5/dominio materializa las siguientes con consentimiento confirmado. Las ya materializadas sobreviven sin red; no hay generación nativa indefinida de próximas semanas.
- No funciona antes del primer desbloqueo, con dispositivo apagado ni tras force-stop de Android. No modifica DND/volumen ni garantiza el comportamiento de todos los fabricantes.
- No hay validación remota en Kotlin: P5 debe entregar solo comandos confirmados por servidor. El laboratorio es una prueba local explícita, nunca consentimiento de otra persona.


Las alarmas audibles aceptadas con `taskId` repiten la misma ocurrencia cada diez minutos hasta recibir la retirada por tarea completada, desactivación o revocación. Detener/Posponer agenda diez minutos desde el toque; sin interacción suena un minuto y el siguiente turno mantiene diez minutos desde el inicio previo. La cancelación explícita se serializa con el timeout y nunca rearma `CANCELLED`. Ver política, evidencia y límites offline en `docs/qa/ALARM_RUNTIME.md`; requiere APK nueva.
