# Runtime Android — P4

Punto de partida del módulo Expo local. **Todavía no programa, cancela ni hace sonar alarmas.** Kotlin no se ha compilado ni validado en dispositivo. El adaptador de la app es `src/platform/alarms/index.ts`: informa indisponibilidad y rechaza mutaciones con `E_NOT_IMPLEMENTED`; nunca confundirlo con una programación confirmada.

## Primera entrega

1. Con P1, comprobar autolinking de `AlarmRuntimeModule` en una development build Android y añadir el puente JS opcional. El directorio `modules/` es el estándar para módulos Expo locales; el scaffold no requiere importar nativo para arrancar la UI. Expo Go no carga este módulo.
2. Implementar store nativo privado, identidad de ocurrencia y revisión de consentimiento. Rechazar comandos caducados/obsoletos antes de programar; conservar tombstones de cancelación.
3. Implementar capacidades/permisos, AlarmManager, receptor y presentación/sonido con detener/posponer. Añadir permisos/componentes al manifiesto del módulo según el diseño validado; no editar únicamente archivos generados por prebuild.
4. Devolver `SCHEDULED` solo tras persistencia y programación real; `getSnapshot` debe reflejar el store. Aceptación en la API del VPS no equivale a programación. El runtime no depende de la API remota ni depende de callbacks JS para sonar.
5. Validar en teléfono: aceptar → programar → cerrar proceso → sonar → detener; además permiso denegado, cancelación, cambio horario, reinicio y recurrencia. Forzar detención desde ajustes es un caso distinto.

P5 integra snapshots/outbox; P2 presenta permisos y pendientes; P6 prueba widget y dispositivos. Ver [TDD](../../docs/TDD.md#5-contratos-de-datos-y-api) y [reparto](../../docs/TEAM_PLAN.md). P5 mantiene una sola ruta de avisos push Expo si se habilita; el runtime no recibe órdenes de activación unilateral desde un push.

Base consultada: [módulos locales](https://docs.expo.dev/modules/get-started/), [registro del módulo](https://docs.expo.dev/modules/module-config/) y [plantilla Gradle oficial](https://github.com/expo/expo/blob/main/packages/expo-module-template/android/build.gradle). Hay que verificar la compilación contra la versión Expo fijada por P1.
