# QA — alarma real Android (P4)

**Estado:** matriz pendiente de ejecutar en hardware. El código está implementado, pero ningún resultado de esta tabla debe marcarse como superado sin evidencia del dispositivo.

Registrar por prueba: fabricante, modelo, versión de Android/API, permisos concedidos, hora prevista, hora real, resultado y captura o vídeo.

## Preparación

1. `npm ci` y `npx expo prebuild --platform android --clean`.
2. `npm run android` en un dispositivo físico (no emulador para la matriz final).
3. Abrir la pestaña **Tareas**, añadir una tarea con hora futura (`21:00`, `mañana`, `lunes`) y tocar «Aviso».
4. Conceder alarmas exactas y notificaciones desde el chip «Permisos» si aparece.
5. Confirmar que la fila muestra «Programada» y que el aviso se adelanta según la prioridad (0, 5 o 10 min).

## Matriz mínima

| # | Caso | Pasos | Resultado esperado |
|---|---|---|---|
| 1 | Programar y sonar | Añadir una tarea con hora futura y tocar «Aviso»; bloquear pantalla; esperar | Suena, notificación visible y pantalla de alarma si Android lo permite |
| 2 | App cerrada | Programar; cerrar desde recientes; esperar | Suena igualmente; el store nativo conserva `SCHEDULED` y luego `FIRED` |
| 3 | Detener | Con la alarma sonando, pulsar «Detener» en la notificación | El sonido cesa; estado `FIRED` con `dismissedAtEpochMs` |
| 4 | Posponer | Con la alarma sonando, pulsar «Posponer 5 min» | El sonido cesa; misma identidad, `snoozeCount = 1`, suena 5 min después |
| 5 | Cancelar antes de sonar | Programar una tarea y volver a tocar su chip «Programada» | No suena; el chip vuelve a «Aviso» y el store nativo queda `CANCELLED` |
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

## Matriz de integración con tareas

Además de las pruebas del runtime, validar el flujo de producto en la pestaña **Tareas**:

| # | Caso | Pasos | Resultado esperado |
|---|---|---|---|
| T1 | Programar desde una tarea | Añadir tarea con hora futura, prioridad alta y tocar «Aviso» | Chip «Programada»; la notificación aparece a la hora menos 10 min |
| T2 | Prioridad normal | Repetir con prioridad normal | El aviso se adelanta 5 min |
| T3 | Prioridad baja | Repetir con prioridad baja | El aviso suena a la hora límite |
| T4 | Silenciar | Tocar el icono de campana en una tarea programada | Se reprograma en modo `NOTIFICATION`; no reproduce sonido sostenido |
| T5 | Completar tarea | Marcar la casilla de una tarea con alarma | La alarma se cancela antes de marcarla; no suena después |
| T6 | Quitar tarea | Quitar una tarea con alarma | La alarma se cancela y la fila desaparece |
| T7 | Hora inválida | Escribir una hora no reconocida y tocar «Aviso» | Chip «Reintentar» y mensaje; nunca «Programada» |
| T8 | Sin permisos | Revocar alarmas exactas y tocar «Aviso» | Chip «Permiso»; el botón «Permisos» abre los ajustes correctos |
| T9 | Tablón | Abrir Tablón con una tarea programada | Muestra el detalle del aviso y permite silenciarlo o detenerlo |
| T10 | Expo Go | Abrir Tareas en Expo Go | Aviso de development build; no se simula una programación |

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
