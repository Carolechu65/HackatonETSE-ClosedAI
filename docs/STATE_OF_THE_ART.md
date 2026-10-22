# Estado de las prácticas y decisiones — octubre de 2026

**Corte de investigación: 22 de octubre de 2026.** Se han contrastado fuentes oficiales disponibles en esa fecha. Aquí «SOTA» significa prácticas actuales pertinentes para construir alarmaT; no una clasificación universal de frameworks ni evidencia de que el prototipo ya alcance determinados resultados. Las recomendaciones para este hackathon son decisiones del equipo derivadas de esas fuentes.

## Conclusiones aplicables

| Área | Evidencia y práctica actual | Decisión para alarmaT |
|---|---|---|
| App y desarrollo | Expo permite añadir integración nativa mediante módulos locales. [Expo Modules API](https://docs.expo.dev/modules/get-started/). | React Native + TypeScript + Expo Router; funcionalidades separadas y adaptador nativo acotado para alarmas. |
| Modularización | Las fronteras de módulos deben responder a necesidades y costes del proyecto. [Guía Android](https://developer.android.com/topic/modularization). | Seis propietarios de áreas dentro de un proyecto Expo y backend separado; no un paquete o módulo Gradle por persona. |
| Alarmas | AlarmManager programa eventos fuera del proceso, sujeto a permisos y restricciones. [Alarmas Android](https://developer.android.com/develop/background-work/services/alarms). | Persistir consentimiento y programación; implementar recepción, sonido y acciones; comprobar en dispositivos físicos. |
| Widgets | expo-widgets ofrece integración nativa con un entorno de ejecución propio. [Expo Widgets](https://docs.expo.dev/versions/latest/sdk/widgets/). | Development build, proyección pequeña y acciones que respeten los contratos. Abrir la app cuando sea necesario. |
| API y persistencia en VPS | SQLite es una base embebida; WAL permite concurrencia de lecturas y escritura, con un escritor a la vez. [WAL](https://www.sqlite.org/wal.html). | Node 22 + Fastify + better-sqlite3; archivo en disco persistente local del VPS, detrás de HTTPS. SQLite no sustituye autenticación, autorización ni mensajería. |
| Concurrencia | Las transacciones SQLite agrupan cambios; puede haber SQLITE_BUSY y hay que manejar las fronteras de transacción. [Transacciones](https://www.sqlite.org/lang_transaction.html). | Comandos con ID, versiones y outbox transaccional del servidor; efectos de red fuera de transacciones; deduplicación también en móvil. |
| Offline | expo-sqlite conserva datos locales; SecureStore ofrece almacenamiento de secretos en el dispositivo. [SQLite Expo](https://docs.expo.dev/versions/latest/sdk/sqlite/), [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/). | Tres registros: SQLite del VPS compartida, SQLite local para proyección/outbox y registro nativo operativo. Sesión opaca en SecureStore. Nuevas aceptaciones requieren confirmación de versión; detener una alarma propia funciona localmente. |
| Autorización | Fastify permite validar contratos y separar plugins/rutas; la política de acceso sigue siendo código de aplicación. [Validación y serialización](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/). | Autenticación y autorización explícitas en cada lectura, operación y página de sync. Solo el destinatario puede consentir; pertenecer al grupo no da acceso a todas las propuestas privadas. |
| Sincronización y push | Expo Push Service requiere configuración de credenciales; Android usa FCM como transporte. [Configuración Expo](https://docs.expo.dev/push-notifications/push-notifications-setup/). | GET /v1/sync al abrir/reanudar, polling activo y SSE opcional. Push con expo-notifications opcional, sin SDK de datos/auth Firebase; nunca garantiza ejecución background ni hace sonar por sí solo la alarma. |
| Verificación | Fastify permite probar rutas con inyección HTTP. [Pruebas Fastify](https://fastify.dev/docs/latest/Guides/Testing/). | API con SQLite temporal, contratos, autorización y concurrencia en CI; sonido, Doze, reinicio y widgets en Android real. No confundir compilar functions/ heredado con probar server/ nuevo. |

## Organización del código elegida

La combinación para este plazo es **Expo/React Native + API HTTPS y SQLite en VPS + contratos pequeños + integración diaria**. Se aprovechan TypeScript y el VPS disponible. Es una elección del equipo para este alcance, no una afirmación de que operar autenticación y servidor propios sea siempre más rápido que un servicio administrado. El control nativo se concentra en el punto que define al producto: que una alarma aceptada se programe y pueda detenerse. No se plantea reescribir toda la app en Kotlin.

El [TDD](TDD.md) define interfaces, estados y datos. [TEAM_PLAN.md](TEAM_PLAN.md) asigna seis responsables y dependencias. [CONTRIBUTING.md](../CONTRIBUTING.md) concreta convenciones, revisión y uso de asistentes de código. La migración documental define `server/` como destino; el código actual de `functions/` y `firebase/` permanece como legado hasta que P3 implemente el reemplazo y P1 adapte scripts/CI.

No se introducirán microservicios, un agente permanente por persona, un framework genérico de plugins ni una segunda base compartida para el MVP. La IA se limita inicialmente a sugerir o aclarar; las decisiones de consentimiento, permisos y horarios siguen siendo explícitas y comprobables.

## Qué debe demostrar el prototipo

1. La propuesta entre dos personas conserva identidad, versión y decisión individual.
2. Rechazar no programa nada; aceptar sin permisos muestra el bloqueo; aceptar con permisos produce una alarma local comprobada.
3. Cambiar hora, reintentar y recibir eventos atrasados no duplica ni reactiva alarmas canceladas.
4. Una pérdida de conexión se representa como pendiente y no como éxito remoto.
5. La experiencia funciona sin consultar un modelo de IA.

Todavía no hay medidas de tamaño, memoria, batería ni precisión. Deben registrarse sobre una compilación de distribución y dispositivos identificados. Expo puede ahorrar tiempo de desarrollo, pero no demuestra por sí mismo que el APK sea más pequeño o consuma menos batería.

## Investigación detallada

- [Android: arquitectura, alarmas, widgets y matriz de pruebas](ANDROID_PRACTICES.md).
- [SQLite y VPS: datos, autorización, consistencia, sincronización, pruebas y despliegue](SQLITE_VPS_PRACTICES.md).

Estos documentos contienen límites y fuentes adicionales. Antes de inicializar el proyecto se fijarán versiones compatibles de Expo, React Native, sus plugins, Fastify, better-sqlite3 y Node; la fecha de una página no debe confundirse con la disponibilidad estable de una API.
