# Evidencia P4 — 22 de octubre de 2026

## Comprobaciones ejecutadas

| Comprobación | Resultado observado |
|---|---|
| Expo prebuild Android con configuración integrada | Correcto; autolinking resuelve `alarm-runtime` y `expo.modules.alarmruntime.AlarmRuntimeModule`. |
| Kotlin de todos los archivos del módulo, puente Expo, presentación y pruebas | **Compila**, con Kotlin 2.2.0/JVM 17, android.jar API 37.0 oficial, React Android 0.88.0, AndroidX Core 1.17.0 y ExpoModulesCore 58.0.24 real. Sin clases stub. |
| JUnit `AlarmPolicyTest` | **3 pruebas, 0 fallos**: barreras de cancelación, tres ejes de versión y rechazo de disparos antiguos/terminales. |
| `tests/p4-notifications.test.ts` con Node 22 | **5 pruebas, 0 fallos**: duplicado, permiso, tombstone, cancelación fallida, recuperación/caducidad y reaceptación confirmada. |
| APK completo de esta integración | **No obtenido**. Los intentos Gradle terminaron al desaparecer el daemon bajo presión de memoria; el entorno efímero perdió después SDK/cache/logs de `/tmp`. |
| Sonido en teléfono, pantalla bloqueada, reboot y sin proceso JS | **Pendiente**: no había dispositivo conectado. |

La compilación alternativa usa el `classes.jar` real de ExpoModulesCore que el intento Gradle sí terminó. Verifica sintaxis Kotlin y compatibilidad de sus APIs, **no** sustituye el ensamblado Android, la fusión final de manifiestos ni las pruebas físicas.

## Reproducir en una máquina con toolchain Android

```sh
npm ci
npx expo prebuild --platform android --no-install
cd android
./gradlew :alarm-runtime:compileDebugKotlin :alarm-runtime:testDebugUnitTest --max-workers=1
./gradlew :app:assembleDebug --max-workers=1 -PreactNativeArchitectures=arm64-v8a
```

Usar Node 22 y JDK compatibles con el Gradle del proyecto. La validación aislada adicional se ejecutó con `org.jetbrains.kotlin.cli.jvm.K2JVMCompiler`, `-jvm-target 17` y las dependencias reales descritas arriba. El artefacto local de comprobación quedó en `/home/kripta/.local/share/alarmat-kotlin-check/alarm-runtime-checked.jar`; no es un APK ni un entregable instalable.

Los tests y fuentes están versionados dentro del proyecto; no dependen de archivos en `/tmp`. Las pruebas de reglas no acreditan por sí solas durabilidad de SharedPreferences, ejecución del servicio o entrega del sistema. Para esos recorridos sigue pendiente la matriz de `docs/qa/ALARM_RUNTIME.md`, usando las nuevas semánticas de parada y revisión descritas en el README del módulo.

## Intento de release para producción, 22-10-2026

- Prebuild Android completo correcto, con autolinking `alarm-runtime`,
  `expo-widgets` y `AlarmaTWidgetProvider` real, firma release externa y backups
  desactivados para impedir restaurar el registro de otro dispositivo.
- 22/22 pruebas TS de widgets y notificaciones aprobadas con Node 22.
- Gradle 9.4.1, SDK 37.0, NDK 27.1, JDK 25 (toolchain 17), ARM64, un worker,
  heap 768 MB, metaspace 384 MB y Kotlin en proceso. El build llegó a
  `react-native-worklets:configureCMakeRelWithDebInfo[arm64-v8a]`.
- **Sin APK**: el guard de disco terminó ese daemon al consumir la reserva del VPS.
  Se retiró únicamente el NDK descargado en ese intento, recuperando unos 2 GB;
  los servicios y archivos ajenos se conservaron. El fallo observado no se
  presenta como prueba de error de Kotlin ni como ensamblado completado.
- `adb devices` devolvió lista vacía; sonido/launcher/reinicio siguen pendientes
  de teléfono físico. El API final confirmado es
  `https://gex-dashboard.hopto.org/alarmat/api`.
- Flujo reproducible y fallback GitHub Actions: `docs/ANDROID_RELEASE.md`.
  El workflow está preparado; no fue ejecutado ni generó un artifact todavía.
