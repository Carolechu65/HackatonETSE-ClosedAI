# Integración P1–P6 · 22 de octubre de 2026

La rama `feat/p1-p6-product-integration` integra main, dAlarmas, P6, MERGES y
el commit compartido P5 `81fce36`. El checkout de otras personas se conserva.
No se han desplegado cambios sobre J&A Automation.

## Recorrido disponible

- Acceso y registro reales, pisos, miembros e invitaciones de un uso.
- Tablón Nevera Retro adaptable, listas y formularios de tareas y alarmas.
- Proponer a otros miembros, aceptar/rechazar, cambiar hora, desactivar y retirar.
- Estados independientes de recepción, decisión, programación y cancelación por destinatario.
- Tareas con responsable, activación y vencimiento; completar/cancelar retira sus avisos.
- Asistente OpenRouter `deepseek/deepseek-v4.1-flash`: aclaraciones y borrador revisable;
  no envía propuestas ni acepta automáticamente. La clave solo está en el servidor.
- Android usa una sesión SecureStore, SQLite/outbox P5 y runtimes separados para
  alarmas sonoras y notificaciones. Se conserva el estado offline y la posposición.
- Dispositivo principal e identidad de instalación por cuenta; limpieza al cerrar sesión.
- Widget con estado confirmado, hora efectiva, cancelaciones pendientes y enlaces al detalle.
- La web es una consola online; no programa alarmas Android. La demo es explícita,
  en memoria y separada de las cuentas reales. El antiguo esqueleto sigue en `/preview`.

## Ejecutar

Node 22 según `.nvmrc`, `npm ci` y `npm --prefix server ci`.
`npm run check` comprueba app, contratos, pruebas anidadas y servidor SQLite.

Para la app, configurar `EXPO_PUBLIC_API_URL` con el origen HTTPS de la API.
Se permite HTTP solo en desarrollo y hosts locales explícitos. Desde un Android
por USB se puede usar `adb reverse tcp:8787 tcp:8787` y el origen local; el emulador
admite `10.0.2.2`. En web de producción, usar HTTPS.

El servidor se configura según [su README](../../server/README.md) y
[el contrato de integración](../../server/docs/PRODUCT_INTEGRATION.md).
Las variables privadas del proveedor nunca llevan el prefijo `EXPO_PUBLIC_`.

La revisión local usó API `127.0.0.1:8787`, Expo web `127.0.0.1:8091` y CORS
explícito. Son procesos de desarrollo; no constituyen un despliegue público.

## Evidencia y límites

Los tests de dominio/datos incluyen SQLite real, aislamiento de cuentas,
idempotencia, respuesta tardía de una sesión anterior, rechazo de datos ajenos,
reintentos de ACK y recuperación offline. El E2E de servidor/P5 verifica A propone,
B acepta, runtime confirma, A consulta el estado, retirada offline y cancelación
confirmada al reconectar. El runtime de ese E2E es falso explícito.

Playwright comprobó dos cuentas reales: A propone, B acepta y A ve la aceptación sin programación ficticia. También comprobó acceso y tablón, cancelar cambio de hora sin responder,
aceptar sin fingir programación, tareas y diseño móvil de 390 px sin desbordamiento.
La prueba real del proveedor verifica aclaración y borrador sin crear alarmas. La GUI del asistente verifica borrador → revisión → envío y cero alarmas antes de confirmar. Los bundles Android y web se exportan correctamente.

El módulo Kotlin completo compila contra dependencias Android/Expo reales y sus
pruebas JUnit pasan. [Evidencia nativa](../../modules/alarm-runtime/BUILD_EVIDENCE.md).
El intento de APK perdió el daemon por recursos del VPS: no hay un APK nuevo
validado en esta entrega. Sonido, bloqueo, reinicio, batería, launcher y push real
requieren las [pruebas físicas](P6_WIDGET.md). Un bundle JS no acredita esos casos.

Siguen fuera de esta integración: finanzas del esqueleto, coordinación avanzada,
tareas recurrentes/rotaciones y preferencias por emisor. Las tareas requieren
conexión; la cola offline durable actual cubre operaciones de alarmas. El widget
actual publica el primer piso de su proyección; la selección de piso del widget
es una ampliación pendiente. Las siguientes ocurrencias semanales se calculan al reconciliar; no se promete una serie autónoma con la app permanentemente detenida. Consultar FEATURES para el alcance más amplio.
