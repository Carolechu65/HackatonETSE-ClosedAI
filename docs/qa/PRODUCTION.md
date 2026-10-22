# Revisión P1–P6 y producción · 22-10-2026

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

Comprobación final de la integración: **240 pruebas app/datos y 70 API aprobadas**,
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
Las46 unidades de servicio preexistentes siguen activas y no falta ningún puerto
de aplicación de la muestra inicial.

## Interfaz P1 restaurada

Las referencias visuales autorizadas son `76d21a9` y `13e09b4` de
`P1-Esqueleto`. Producción reutiliza su tipografía, notas y barra inferior
Tablón/Gastos/Tareas/Piso, conectadas con cuentas, tareas y gastos reales.
Los formularios avanzados, alarmas, asistente, calendario y permisos siguen
accesibles desde esas pantallas. Se verifican las cuatro pestañas a360,390
y430px. Los datos de ejemplo permanecen identificados como demostración.
