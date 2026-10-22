# Revisión P1–P6 y producción · 22-10-2026

## Estado vigente verificado · 22-10-2026

La release activa es `20261022T163633Z-ocr`, esquema SQLite 8. Integra tickets OCR,
reparto por importes y porcentajes, edición de gastos y adjuntos revisables, además
de widgets y aceptación de asignaciones. Las fechas y versiones de las secciones
inferiores son registros históricos, no la versión actualmente servida.

La fuente integrada `cb59d37` contiene el código de la web/API publicada. Una
compilación nueva del servidor coincide byte a byte con los 122 archivos de
`server/dist` activos; las 8 migraciones también coinciden. Los 81 archivos de la
exportación web de compilación, comprobados antes de limpiar temporales, coinciden
con producción. El adaptador OCR, la unidad
de servicio, el fragmento Caddy, la guía de instalación, el logo y la presentación
portable corresponden a los archivos versionados. Las huellas se conservan en
[el manifiesto del despliegue](DEPLOYMENT_SNAPSHOT.json).

La presentación que sigue publicada en `/alarmat/presentation/` se conserva en
`presentation/`. `presentacionfinal/` contiene la versión posterior del borrador;
no sustituye automáticamente la presentación servida. La portable sigue publicada
en `/alarmat/presentacion-portable.html`.

El APK actual procede de `b236f0a`, contiene los tres widgets y asignaciones, y no
incluye la interfaz OCR. Mantiene su firma y checksum publicados. La web y el APK
son artefactos distintos: este push no recompila ni reemplaza el APK instalado.

Validación de cierre: `npm run check` con 281 pruebas de app y 92 de servidor
correctas, 42 fixtures y 15 esquemas válidos; solo se omite el test externo optativo
del proveedor. La demo real con Ana y Bruno verificó propuestas, respuestas y hora
personal, tarea vinculada y completado, lectura OCR de un ticket ficticio, reparto,
edición y pago de cuota. Las cuatro pestañas no desbordan a 360/390/430 px.
Google Calendar requiere autorización de las cuentas; sonido, bloqueo y launcher
Android siguen pendientes de validación física.

La limpieza de espacio afectó únicamente a cachés, herramientas descargables,
compilaciones, dependencias de desarrollo regenerables, duplicados y releases
antiguas de AlarmaT. Se conservan release activa y rollback inmediato, APK actual y
anterior, código de todos los checkouts, evidencias textuales, entregables de demo,
SQLite/WAL/SHM, tickets OCR, backups y secretos de firma. Las herramientas y
cachés de Android se reinstalan antes de una futura compilación; las dependencias
de desarrollo se recuperan con `npm ci` en raíz y servidor. Producción ejecuta su
propia instalación y no depende de esos directorios de desarrollo.

## Actualización de personas, tareas, gastos y asistente

Última publicación web: `347d2a5`, release `20261022T155651Z`, esquema 6.
Añade historial de gastos plegado por defecto con contador y paginación de tres;
el formulario sigue disponible. Prueba aislada con siete movimientos, apertura,
cierre conservando el borrador y creación de un octavo correcta; comprobado
también en HTTPS real sin modificar datos de producción. Se conservaron el enlace
`downloads` y la guía `install/index.html`.

APK `347d2a5` también publicado en la descarga habitual tras build release,
17 verificaciones y comparación de la descarga HTTPS. Incluye la repetición
nativa de tareas; ver `../ANDROID_RELEASE.md`. Validación física pendiente.

Publicado `ae2290f` en `/opt/alarmat/releases/20261022T154727Z`, con
esquema 6 y copia previa consistente. HTTPS confirma esquema 6 y sirve la
misma exportación que se probó. Se conservan las rutas y la configuración Caddy.

- Piso: iconos pulsables con avisos creados por el usuario para esa persona;
  se filtran piso, autor y destinatario. Enviadas muestra personas, horarios,
  respuesta, recepción y ejecución, incluida una hora elegida diferente.
- Tareas: completar y volver a pendiente, con versión e idempotencia; reabrir
  no reactiva propuestas retiradas. El detalle de un aviso muestra su tarea.
- Gastos: participantes elegidos, pagador opcional en el reparto y fecha límite
  civil opcional. La migración 006 no cambia importes ni pagos existentes.
- Alarmas propias: formulario y chat permiten seleccionar al usuario actual;
  la propuesta sigue requiriendo aceptación propia y nunca permite decidir por otro.
- Asistente: instante real, fecha/hora local, zona, miembros, tareas compartidas
  y alarmas autorizadas enviadas/recibidas. Contexto limitado con indicador de
  truncamiento; las tareas pendientes pueden enlazarse al borrador.

Verificación: `npm run check` con **254 pruebas app y 80 API correctas**, una
prueba externa omitida en esa ejecución; exportación web correcta. Chromium
verifica siete flujos a 360/390/430 px, sin errores ni desbordamiento. API de
pruebas en memoria, sin modificar datos reales. El proveedor real también pasó
«mañana a las22h» y «dentro de10 minutos», con destinatario propio y tarea
correcta, sin crear propuestas antes de confirmar. Evidencia local:
`/srv/mail/alarmat-build/member-details-20261022/`.

La repetición sonora de tareas cada diez minutos está implementada y verificada
en fuentes Kotlin/reconciliación (ver `ALARM_RUNTIME.md`), y requiere APK
actualizada. Publicar web/API no actualiza una instalación Android anterior;
sonido y pantalla bloqueada aún necesitan comprobación física.

La publicación autorizada corresponde exclusivamente a
**https://gex-dashboard.hopto.org/alarmat/**. Ver [operación del VPS](../../deploy/README.md).

| Área | Evidencia de implementación y prueba | Límite real |
|---|---|---|
| P1 Base/contratos | Node22, lockfiles, tipos app/tests, fixtures, CI, export web bajo prefijo y configuración de firma Android. | Una exportación JS no prueba un APK. |
| P2 Pantallas | Dos cuentas reales en navegador móvil/escritorio: acceso, envío, aceptación pendiente y estado visible al emisor. | Web no programa alarmas nativas; al recargar pide acceso. |
| P3 API/agente | SQLite migrada, autenticación, autorización, idempotencia, límites y consulta real a DeepSeek. El borrador no crea una alarma antes de confirmar. | Push opcional sin configurar; sincronización al abrir/reanudar. |
| P4 Android | Registro nativo, permisos, recepción, sonido/detener/posponer y reconciliación; pruebas dirigidas y compilación Kotlin previa. | Sonido real, pantalla bloqueada, reinicio y batería requieren dispositivo. |
| P5 Datos | SecureStore, SQLite/outbox de alarmas, versiones, ACK/reintentos, sesión y transporte HTTPS con prefijo. | Las tareas aún requieren conexión. |
| P6 Tareas/widget | Tareas reales con descripción/categoría, completar/cancelar y aviso vinculado; widget del piso elegido con antigüedad real de lectura y enlaces autorizados. | Instalar y refrescar widget en launcher real sigue siendo prueba física. |

La pestaña Gastos registra importes EUR, reparto igual con redondeo exacto y
liquidación de la cuota propia; no realiza transferencias. Se mantienen fuera
del núcleo de los prompts P1–P6: huchas, rotaciones,
intercambios, recurrencia propia de tareas y widgets financieros. La recurrencia
semanal de avisos se reconcilia al abrir la aplicación; no se promete una serie
indefinida con la app permanentemente detenida.

## Pruebas antes de publicar

Comprobación final de la integración: **244 pruebas app/datos y 70 API aprobadas**,
una prueba externa omitida por defecto y ejecutada por separado con éxito.
El fallo de acceso bajo `/alarmat/api` se detectó en navegador y se corrigió con
regresiones de transporte (14 pruebas dirigidas, incluyendo las nuevas).
Incluye calendario con proveedor Google simulado y las correcciones selectivas
de la rama de seguridad, preservando los contratos actuales.

En HTTPS ya se comprobó con dos cuentas: A propone, B acepta y A ve recepción y
aceptación, sin inventar una programación Android desde el navegador.
Se verificaron además las redirecciones y respuestas de ocho rutas existentes
antes/después de Caddy; permanecen iguales. Se restauró el vhost de
`app.j-aautomation.com` a su configuración original tras corregir el destino.
La API utiliza solo loopback18787 y no comparte base ni puertos con otras apps.

Copias: backup consistente real e integridad/restauración comprobados; timer
habilitado. Sincronización, sonido, widgets, push y OAuth físico no se confunden
con pruebas simuladas o suites de servidor.

El callback OAuth se comprobó en HTTPS: estados con prefijo `alarmat_` llegan
exclusivamente a AlarmaT; un estado inválido devuelve400 con HTML propio.
Los callbacks normales de Lois conservan307 y su destino. Caddy requiere una
expresión explícita para el prefijo: `query state=alarmat_*` sería literal.
Las45 unidades persistentes de servicio de la muestra siguen activas.
`polkit` es una unidad bajo demanda y puede estar inactiva sin fallo. Los
endpoints de producción conservan sus respuestas; puertos temporales del
contenedor y de desarrollo pueden cambiar entre sesiones.

## Interfaz P1 restaurada

Las referencias visuales autorizadas son `76d21a9` y `13e09b4` de
`P1-Esqueleto`. Producción reutiliza su tipografía, notas y barra inferior
Tablón/Gastos/Tareas/Piso, conectadas con cuentas, tareas y gastos reales.
Los formularios avanzados, alarmas, asistente, calendario y permisos siguen
accesibles desde esas pantallas. Se verifican las cuatro pestañas a360,390
y430px. Los datos de ejemplo permanecen identificados como demostración.

La comprobación HTTPS posterior al esquema5 pasó con dos cuentas reales:
proponer/aceptar un aviso, crear/completar tareas, añadir un gasto de12,51EUR
con reparto exacto y liquidar únicamente la cuota propia. El logo y favicon
actualizados están publicados. Las cuatro pantallas se revisaron a360/390/430px.

## Navegación táctil

El menú web permanece fijo al pie, con espacio reservado para el contenido.
El swipe horizontal cambia entre las cuatro pestañas y respeta campos, botones,
desplazamiento vertical y bordes del navegador. Tareas muestra4filas por página
y Gastos3, manteniendo saldos y contadores globales. Chromium con eventos táctiles
CDP comprobó cambios en ambos sentidos, paginación/alta de tareas y menú fijo
después de desplazar una pantalla de360×460px.


## Widgets y asignaciones · 22-10-2026 · e8999db

Web/API publicados en `/opt/alarmat/releases/20261022T162716Z`, esquema 7.
Migración aditiva: las tareas antiguas conservan `assignment_decision=not_required`.
Las nuevas asignaciones a otra persona requieren aceptar/rechazar, sin alterar el
consentimiento independiente de una alarma o notificación vinculada. Crear un aviso
con la opción predeterminada de tarea guarda ambas entidades en una transacción
idempotente. Avisos independientes y tareas existentes siguen disponibles.

`npm run check`: 277 pruebas de app + 83 de servidor correctas; una prueba opcional
con proveedor externo omitida. QA aislada con 84 peticiones y sin errores: creación
atómica, aprobación del destinatario, bloqueo del emisor, completar/reabrir, alarma
propia y vistas de widgets en 360/390/430 px. QA HTTPS solo lectura de widgets,
instalación, login y salud del API correcta.

Widgets: Alarmas, Tareas y Tablón comparten la paleta de la app, muestran títulos,
responsables/fechas y checklist con acciones versionadas. Los botones de completar
abren la app y aplican el cambio autenticado, sin fingir éxito en el launcher.

Los avisos de asignación usan `/v1/assignments` y deduplicación nativa compartida.
Android consulta en segundo plano con JobScheduler (mínimo 15 minutos, aplazable
por el sistema), además de la sincronización con la app abierta. No se presenta
como push instantáneo; Expo/FCM sigue sin configuración. Falta comprobar físicamente
el launcher, la ejecución de jobs y los permisos del fabricante.

Evidencia: `/srv/mail/alarmat-build/widgets-20261022/`.
