# Google Calendar personal

AlarmaT reutiliza el cliente OAuth de Lois. Cada usuario autoriza su propia cuenta de Google: no se comparte el token ni la agenda de la peluquería. La pantalla `/calendar` permite elegir calendario, consultar semanas y crear eventos. Las tareas pendientes y los avisos aceptados pueden rellenar el formulario; guardar crea una copia, no una sincronización bidireccional. No invita asistentes ni activa alarmas de AlarmaT.

## Producción

Destino autorizado: https://gex-dashboard.hopto.org/alarmat/ con API `/alarmat/api`. Compilar web con `ALARMAT_WEB_BASE_PATH=/alarmat` y `EXPO_PUBLIC_API_URL=https://gex-dashboard.hopto.org/alarmat/api`.

Las seis variables opcionales de `server/.env.example` se guardan fuera del repositorio en `/etc/alarmat/calendar.env` (0600). Se reutilizan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET del servicio Lois, conservando CALENDAR_ENCRYPTION_KEY entre despliegues. No copiar tokens de usuarios de Lois. Instalar `deploy/calendar-service.conf` como drop-in systemd. Aplicar migración `004_google_calendar.sql` antes de arrancar el servidor actualizado.

Importar `deploy/google-calendar.caddy` dentro del bloque existente de **gex-dashboard.hopto.org**, antes de los handlers de Lois. Solo el callback con `state=alarmat_*` se dirige a AlarmaT; los callbacks normales siguen en Lois. No modificar los otros dominios. Puerto API: 18787.

Configuración pública:

- GOOGLE_REDIRECT_URI=https://gex-dashboard.hopto.org/nexia/lois/citas/api/google-calendar/callback
- CALENDAR_PUBLIC_API_URL=https://gex-dashboard.hopto.org/alarmat/api
- CALENDAR_APP_URL=https://gex-dashboard.hopto.org/alarmat/

Se conserva el callback ya registrado en Google. La pantalla de consentimiento puede mostrar el nombre del cliente compartido con Lois. Las restricciones de usuarios de prueba/verificación del proyecto Google siguen aplicándose.

## Autorización y privacidad

El navegador abre Google desde una ventana iniciada por el usuario. Android vuelve mediante `alarmat://calendar`. Se requiere la misma sesión de AlarmaT que inició el proceso. PKCE, estado y cookie de navegador de un solo uso protegen el callback; un segundo código de confirmación vinculado a la sesión instala la conexión. Los tokens se cifran con AES-256-GCM y no llegan al frontend. La API aísla cada agenda por usuario, renueva tokens y detecta permisos caducados.

Desconectar elimina el acceso guardado en AlarmaT y conserva eventos. No revoca globalmente el cliente compartido de Google porque podría afectar a Lois. El usuario puede retirar permisos desde su cuenta Google. Sin configuración OAuth, la app sigue funcionando y muestra el calendario como no configurado.

## Validación

`npm run check` valida contratos, tipos y suites de servidor/cliente. `server/test/calendar.test.ts` cubre PKCE, cifrado, sesión/usuario, replay, permisos, eventos de día completo, idempotencia y carreras con desconexión usando un proveedor Google simulado. `npm run export:web` comprueba la compilación web. La autorización con una cuenta Google real requiere el consentimiento de su titular; las pruebas simuladas no sustituyen esa comprobación.
