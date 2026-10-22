# Runtime Android — P4

**Estado:** primer prototipo implementado en la rama `dAlarmas`. Programa alarmas exactas con `AlarmManager`, suenan en un foreground service sin React, se detienen/posponen desde la notificación o la pantalla de alarma y se recuperan tras reinicio. **Kotlin compila y el APK debug se ensambla correctamente; la validación física sigue pendiente** (ver [QA](../../docs/qa/ALARM_RUNTIME.md)).

El adaptador de la app es [`src/platform/alarms/index.ts`](../../../src/platform/alarms/index.ts). Si el módulo no está instalado (Expo Go, web o una build antigua), devuelve `unavailableAlarmRuntime` y la UI muestra «no disponible»; nunca simula una programación.

## Qué implementa

| Pieza | Archivo | Responsabilidad |
|---|---|---|
| Puente JS | `AlarmRuntimeModule.kt` | `getCapabilities`, `schedule`, `cancel`, `stop`, `snooze`, `getSnapshot`, `reconcile`, permisos y ajustes. |
| Store privado | `AlarmStore.kt` | Persistencia **antes** de programar; revisión y tombstones de cancelación en SharedPreferences. |
| Programación | `AlarmScheduler.kt` | `setAlarmClock()` con `AlarmClockInfo`; exige acceso a alarmas exactas. |
| Disparo | `AlarmFiredReceiver.kt` | Sin JS: arranca el servicio (modo `ALARM`) o publica recordatorio (modo `NOTIFICATION`). |
| Sonido | `AlarmService.kt` | Foreground service `mediaPlayback`, `MediaPlayer` con `USAGE_ALARM`, wake lock y tope de 10 min. |
| Acciones | `AlarmActionReceiver.kt` / `AlarmActivity.kt` | Detener y posponer desde notificación o pantalla bloqueada. |
| Recuperación | `BootReceiver.kt` / `AlarmRecovery.kt` | Reinicio, cambio de hora/zona, actualización; no resucita ocurrencias vencidas. |
| Canales | `AlarmNotifications.kt` | Canal de alarma silencioso (el audio lo controla el servicio) y canal de recordatorios. |

## Flujo de programación

1. JS valida y envía una `LocalOccurrence` con identidad estable `(userId, requestId, occurrenceId, deviceId, deviceEpoch)`.
2. Kotlin persiste el registro como `SCHEDULING` (`commit()` en disco).
3. Comprueba `canScheduleExactAlarms()`. Si falta, responde `PENDING_PERMISSION` y deja el registro `FAILED` con motivo; no miente con `SCHEDULED`.
4. Llama a `setAlarmClock()` y solo entonces marca `SCHEDULED`.
5. Al disparar, el receptor consulta el store; si la ocurrencia fue cancelada o venció, no hace nada.
6. El servicio marca `FIRED` y conserva `firedAtEpochMs`; detener añade `dismissedAtEpochMs`. Posponer conserva la identidad y suma `snoozeCount`.

No hay transacción atómica entre SharedPreferences, `AlarmManager`, el servicio y Firebase. La recuperación se apoya en persistir antes, identidad estable y reconciliación idempotente después.

## Permisos y configuración nativa

Declarados en `android/src/main/AndroidManifest.xml` y replicados en `app.config.ts`:

- `POST_NOTIFICATIONS` (Android 13+): sin aviso visible no se considera lista una alarma audible.
- `SCHEDULE_EXACT_ALARM`: acceso especial; se solicita con `requestExactAlarmPermission()`.
- `RECEIVE_BOOT_COMPLETED`: reprogramación tras reinicio.
- `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK`: sonido sostenido.
- `WAKE_LOCK`: mantener reproducción con pantalla apagada.
- `USE_FULL_SCREEN_INTENT`: pantalla de alarma cuando Android lo concede; si no, queda la notificación.
- `VIBRATE`.

No se declara `USE_EXACT_ALARM` ni se piden permisos de superposición/accesibilidad. El manifiesto está en el módulo versionado, no en `android/` generado, para sobrevivir a `prebuild --clean`.

## Uso desde la app

La pantalla [`AlarmRuntimeLabScreen`](../../../src/features/alarms/AlarmRuntimeLabScreen.tsx) (ruta `/alarm-runtime`, enlace «Alarma real» en la cabecera) permite:

- ver capacidades y conceder permisos;
- programar una alarma real a 10 s, 30 s o 1 min;
- detenerla o posponerla 5 minutos;
- inspeccionar el store nativo y ejecutar la reconciliación.

Es un banco de pruebas: no crea propuestas ni escribe en Firebase.

## Compilar y probar

```sh
npm ci
npx expo prebuild --platform android --clean
npm run android
```

Si `npm ci` falla por el conflicto de peers preexistente entre `react@19.3.0` y `react-dom@19.3.1`, usar `npm ci --legacy-peer-deps`; no cambia el lockfile.

`npm run export:android` solo comprueba JavaScript: no compila Kotlin ni valida sonido. Requiere una development build; Expo Go no carga módulos locales. Verificado en esta rama: `tsc --noEmit`, `expo export --platform android`, `:app:compileDebugKotlin` y `:app:assembleDebug`.

Prueba mínima en un Android físico:

1. Conceder alarmas exactas y notificaciones.
2. Programar a 30 s, bloquear la pantalla y cerrar la app desde recientes.
3. Verificar sonido, notificación visible y pantalla de alarma.
4. Detener desde la notificación; repetir y posponer 5 min.
5. Reiniciar el móvil, desbloquear y comprobar que una alarma futura sigue programada.
6. Revocar alarmas exactas y confirmar `PENDING_PERMISSION`, nunca `SCHEDULED`.

## Límites reales de este prototipo

- **No validado en hardware**: Kotlin y el APK debug compilan, pero falta ejecutar la matriz de [QA](../../docs/qa/ALARM_RUNTIME.md) en teléfonos reales.
- **Force-stop**: Android cancela `PendingIntent`; no se promete resistencia. Es un caso distinto de matar el proceso.
- **Direct Boot**: el store usa almacenamiento protegido por credenciales; no hay alarmas antes del primer desbloqueo.
- **Recurrencia**: no implementada. El contrato P0 semanal requiere materializar la siguiente ocurrencia antes de disparar.
- **Recordatorios estándar**: `expo-notifications` no está instalado; el modo `NOTIFICATION` del runtime publica un aviso sin sonido sostenido. `src/platform/notifications` no finge programarlos.
- **Repetición de sonido**: usa el tono de alarma predeterminado en bucle; personalización de sonido queda pendiente.
- **Doze, ahorro de batería y fabricantes**: `setAlarmClock` ayuda, pero el comportamiento final debe medirse por dispositivo.
- **Política de distribución**: `SCHEDULE_EXACT_ALARM`, `USE_FULL_SCREEN_INTENT` y `mediaPlayback` tienen requisitos de Google Play; revisar antes de publicar.
