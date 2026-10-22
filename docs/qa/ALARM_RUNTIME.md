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
| 3 | Detener | Con la alarma sonando, pulsar «Detener» en la notificación | El sonido cesa; estado `FIRED` con `dismissedAtEpochMs` |
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
