# QA — alarma real Android (P4)

**Estado:** matriz pendiente de ejecutar en hardware. El código está implementado, pero ningún resultado de esta tabla debe marcarse como superado sin evidencia del dispositivo.

Registrar por prueba: fabricante, modelo, versión de Android/API, permisos concedidos, hora prevista, hora real, resultado y captura o vídeo.

## Preparación

1. `npm ci` y `npx expo prebuild --platform android --clean`.
2. `npm run android` en un dispositivo físico (no emulador para la matriz final).
3. Abrir `/alarm-runtime` desde «Alarma real».
4. Conceder alarmas exactas y notificaciones.
5. Confirmar que «Módulo nativo», «Alarmas exactas», «Notificaciones» y «Sonido de alarma» aparecen en verde.

## Matriz mínima

| # | Caso | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | Programar y sonar | Programar a 30 s; bloquear pantalla; esperar | Suena, notificación visible y pantalla de alarma si Android lo permite |
| 2 | App cerrada | Programar; cerrar desde recientes; esperar | Suena igualmente; el store nativo conserva `SCHEDULED` y luego `FIRED` |
| 3 | Detener | Con la alarma sonando, pulsar «Detener» en la notificación | El sonido cesa; estado `CANCELLED` con `dismissedAtEpochMs` (aviso sin tarea) |
| 4 | Posponer | Con la alarma sonando, pulsar «Posponer 5 min» | El sonido cesa; misma identidad, `snoozeCount = 1`, suena 5 min después |
| 5 | Cancelar antes de sonar | Programar a 1 min y cancelar (desde una build con contrato completo) | No suena; estado `CANCELLED` |
| 6 | Reinicio | Programar a 10 min; reiniciar; desbloquear | `reconcile` informa 1 reprogramada y suena a la hora |
| 7 | Reinicio con alarma vencida | Programar a 2 min; apagar 10 min; encender y desbloquear | Se marca `EXPIRED`; no suena tarde |
| 8 | Cambio de hora/zona | Cambiar manualmente la hora/zona con una alarma futura | Se reprograma; no se duplica |
| 9 | Permiso exacto revocado | Revocar alarmas exactas en ajustes; programar | `PENDING_PERMISSION`; la UI no muestra éxito |
| 10 | Notificaciones revocadas | Revocar notificaciones; programar | Bloqueado por permisos; nunca `SCHEDULED` silencioso |
| 11 | Full-screen intent denegado | Desactivar pantalla completa; programar | Suena y se muestra notificación; no se exige la pantalla |
| 12 | Modo silencio/No molestar | Activar DND; programar | Registrar el comportamiento real; no se modifica el ajuste del usuario |
| 13 | Force-stop | Forzar detención en ajustes con alarma futura | Documentar que no suena; es un límite conocido, no un bug |
| 14 | Proceso muerto tras programar | Programar y matar el proceso con `adb shell am kill` | La alarma ya programada sigue sonando |
| 15 | Repetición rápida | Programar/cancelar/programar la misma identidad | Una sola ocurrencia activa, sin duplicados |
| 16 | Reconciliación | Pulsar «Reconciliar» con estados mixtos | No duplica ni resucita `CANCELLED`/`EXPIRED` |
| 17 | Arranque repetido | Reiniciar dos veces con la misma alarma futura | Misma hora, sin avisos duplicados |

## Evidencia en logs

```sh
adb logcat | grep -Ei "alarmruntime|AlarmService|AlarmFired|ForegroundService"
adb shell dumpsys alarm | grep -A 3 "com.closedai.alarmat"
adb shell dumpsys notification --noredact | grep -A 5 "alarm_runtime"
```

## Criterios de bloqueo

- No se puede presentar la demo como «alarma real» si fallan los casos 1, 2, 3 y 4.
- Un `PENDING_PERMISSION` o un fallo de `AlarmManager` no puede mostrarse como programado.
- No se acepta como evidencia un emulador sin sonido ni una notificación de `expo-notifications` en lugar del servicio nativo.


## Recordatorios de tareas (22 de octubre de 2026)

Requiere una APK nueva con este runtime; desplegar la web no incorpora alarmas audibles ni ejecución en segundo plano en el navegador. Solo una propuesta `ALARM` aceptada con `taskId` activa esta política. Las notificaciones ordinarias y las alarmas sin tarea mantienen su comportamiento.

- «Recordar en 10 min» y «Posponer 10 min» silencian y programan la misma ocurrencia para diez minutos después del toque, sin completar la tarea ni cambiar el consentimiento. Un toque duplicado conserva la programación.
- Sin interacción, la alarma de tarea suena como máximo un minuto y vuelve a sonar diez minutos después del inicio anterior. Si otro aviso sustituye su sonido, conserva ese mismo siguiente turno.
- La pantalla nativa ofrece «Ver tarea asociada». Completar la tarea retira sus alarmas en el servidor; el dispositivo cancela tanto una repetición programada como una alarma `FIRED` cuando recibe el cambio. La recepción requiere sincronización; no se promete cancelación remota inmediata con el teléfono desconectado.
- Desactivar/rechazar/retirar, cambiar el dispositivo o cerrar sesión cancela las repeticiones. Reabrir una tarea no restaura avisos retirados ni consentimiento.

Validación automatizada realizada: 16 pruebas de tareas; 3 pruebas de integración del servidor (incluyen reapertura persistente, versión, permisos y conservación de alarmas/consentimiento); 38 pruebas de repositorio/reconciliación, incluidas identidad aceptada, repetición, cancelación `FIRED`, desconexión, limpieza, metadatos y aislamiento de notificaciones. TypeScript pasa. `AlarmPolicyTest` pasa sus 5 pruebas JUnit; las fuentes Kotlin del runtime salvo el bridge Expo sin cambios compilan contra Android SDK 37 y sus dependencias. Artefactos aislados: `/srv/mail/alarmat-build/task-reminder-tests/`.

La matriz física sigue pendiente: comprobar cadencia de diez minutos, timeout de un minuto, sustitución por otra alarma, toque duplicado, completar/desactivar justo antes del timeout y completar desde otro móvil desconectado. Estas comprobaciones no se sustituyen por la compilación o las pruebas unitarias.
