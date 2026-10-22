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

## Navegador: tareas y asistente conectado

El 22-10-2026 se ejecutó Playwright/Chromium contra Expo local `127.0.0.1:8091`
y API `127.0.0.1:8787`, con cuentas y piso de prueba nuevos, sin registrar tokens:

- Escritorio 1280×900: entrar en demo, crear «Prueba GUI cocina P6», abrir su
  recordatorio y comprobar tarea y título preseleccionados; volver y completarla.
  El detalle mostró `COMPLETADA` y retiró los controles de modificación.
- Móvil 390×844: iniciar sesión real y pedir un aviso para Bea, miembro invitado.
  El asistente devolvió un borrador; consultar la API antes de confirmarlo devolvió
  cero propuestas. Revisar y enviar con el formulario ordinario creó la propuesta.
  El detalle mostró «Por responder», «Recepción sin confirmar» y «Sin programación
  confirmada», sin aceptar ni activar nada por abrirlo.
- No se observaron excepciones de página en esos flujos. El formulario excluye al
  emisor, siguiendo el contrato vigente del servidor, e invita a añadir compañeros
  cuando no existe ningún destinatario elegible. Una segunda prueba móvil con un
  piso de un solo miembro verificó la invitación visible, cero opciones para el
  propio usuario y botón «Enviar propuesta» deshabilitado. El asistente mostró la
  aclaración «Invita a otra persona al piso para proponerle un recordatorio. Cada
  destinatario decide si lo acepta.», sin solicitar identificadores técnicos.

Capturas locales de esta ejecución: `/tmp/alarmat-p6-task-reminder.png`,
`/tmp/alarmat-p6-task-completed.png`, `/tmp/alarmat-p6-assistant-live.png` y
`/tmp/alarmat-p6-assistant-review.png`; caso sin destinatarios:
`/tmp/alarmat-p6-no-recipients.png` y `/tmp/alarmat-p6-assistant-no-recipients.png`.
Scripts: `/tmp/alarmat-p6-gui.cjs` y
`/tmp/alarmat-p6-empty-recipients.cjs`.
Estas comprobaciones web no validan sonido, permisos ni interacción del launcher Android.
