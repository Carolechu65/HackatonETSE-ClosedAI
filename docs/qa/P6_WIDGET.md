# P6 · Widget Android y estados de tareas

Fecha: 22-10-2026. Integración de código, sin evidencia de dispositivo físico.

El config plugin `plugins/with-widget-links.cjs` extiende la acción de botones de
`expo-widgets@58.0.22`: para `AlarmaTWidget`, un target interno validado se convierte
en `actionStartActivity` con componente explícito y `ACTION_VIEW`. Glance crea el
PendingIntent al renderizar el widget. No inicia actividades desde un receptor,
no necesita el proceso React abierto y no ejecuta decisiones.

El parche modifica el archivo instalado durante prebuild, se reaplica tras `npm ci`
y falla ante versión/API no revisadas. Debe estar en `app.config.ts` después de
`expo-widgets`; no hay que modificar el módulo de alarmas.

Referencias verificadas:

- [Expo Widgets](https://docs.expo.dev/versions/latest/sdk/widgets/): runtime aislado y publicación de props.
- [Interacciones Glance](https://developer.android.com/develop/ui/compose/glance/user-interaction): acción directa de Activity y limitación de trampolines Android 12+.
- Fuentes instaladas: `expo-widgets/bundle/decorator.ts` preserva targets explícitos;
  `WidgetInteractionAction.kt` usaba broadcasts para todos los botones;
  `ExpoWidgetEmittableTree.kt` transmite el target del botón a esa acción.

Cambios verificables en pruebas: datos persistidos corruptos o de esquema antiguo
se vacían, ocurrencias vencidas no se repintan como próximas, timestamps no finitos
se descartan y la cuenta/grupo se comparan antes de publicar. Las tareas completadas
o canceladas siguen mostrando escritura pendiente, conflicto y retirada sin acuse.
La marca temporal del launcher es absoluta porque un «ahora» congelado engaña.

Comandos (con Node >=22.13):

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/widgets.test.ts tests/tasks.test.ts tests/widget-native.test.ts
npm run typecheck
```

La prueba del plugin comprueba drift e idempotencia contra el paquete instalado y
la política exacta de destinos. No equivale a una compilación Kotlin o a una pulsación
real en un launcher. El agente principal coordina prebuild, Gradle y la exportación.

## Protocolo físico pendiente

Registrar modelo, API Android, build/commit, launcher, fecha y captura para cada paso:

1. Instalar la development build, iniciar sesión, aceptar y programar una alarma futura;
   mantener otra propuesta pendiente. Añadir el widget 4×2 al launcher.
2. Comprobar título, hora, propuestas, pendientes de permiso y marca de lectura.
3. Cerrar normalmente la app y pulsar «Ver alarma»: debe abrir el detalle vigente,
   sin aceptar, cambiar hora ni programar de nuevo.
4. Pulsar «Ver propuestas» y rechazar explícitamente una propuesta. Confirmar refresco.
5. Completar una tarea vinculada con el receptor offline: conservar «sin acuse» hasta
   reconciliar; una alarma detenida nunca completa por sí sola la tarea.
6. Cerrar sesión y cambiar de cuenta/grupo: el widget no conserva títulos/contadores.
7. Abrir un enlace a entidad ajena/inexistente: sin datos privados ni mutación.
8. Dejar la app cerrada y verificar que la marca de lectura no promete datos actuales.
   Distinguir cierre normal de forzar detención desde Ajustes.

No se marca «widget validado en dispositivo» hasta completar este protocolo.

## Evidencia de integración P5/API

`server/test/p5-integration.test.ts` usa los handlers reales de Fastify, SQLite del
servidor y una segunda SQLite del cliente P5, con runtime nativo y almacenamiento
seguro falsos. Verifica recibir sin consentir, aceptar una sola vez, perder la
respuesta HTTP de un ACK ya persistido, reintentarlo sin duplicar la ocurrencia,
consultar el resultado desde el creador, completar la tarea con el receptor
desconectado y confirmar después la cancelación. El cierre de sesión elimina
token, proyección y widget. Pasó en Node 22; no sustituye la prueba física Android.

`tests/data/repositories/snooze.test.ts` verifica que una posposición nativa futura
sobrevive a la reconciliación incluso si P5 ya observó `FIRED`, mantiene el instante
consentido en los ACK y muestra la hora pospuesta en el widget. Retirada, cambio
de versión y desactivación offline prevalecen. El widget conserva el occurrenceId
original, distingue `ALARM` de `NOTIFICATION` y cuenta cancelaciones pendientes
por estado de ejecución, sin confundirlas con todas las operaciones de la cola.
