# Conectar mi IA

Cada usuario conecta una API key propia desde Ajustes. OpenAI propone `gpt-6-luna`,
OpenCode `deepseek-v4.1-flash`, DeepSeek `deepseek-flash` y OpenRouter
`deepseek/deepseek-v4.1-flash`. Se puede escribir otro identificador; la prueba debe
confirmar que ese modelo admite el formato esperado. Una suscripción a un chat no
implica saldo o acceso a la API. El proveedor factura las peticiones a esa clave.

OpenAI y los GPT de OpenCode usan Responses; DeepSeek y OpenRouter usan Chat
Completions. Los destinos HTTPS son constantes y se rechazan redirecciones. No se
admiten URLs arbitrarias, herramientas ni memoria de agentes externos. La salida
sigue pasando por las validaciones de miembros, fechas y consentimiento existentes.
La IA solo prepara propuestas: recibir y aceptar avisos no requiere API key.

## Datos y seguridad

La migración 009 añade tablas; no modifica ni elimina filas existentes. La conexión
usa AES-256-GCM con nonce aleatorio y AAD ligado al usuario, proveedor y modelo.
La API devuelve únicamente proveedor, modelo, fecha y últimos cuatro caracteres.
Ni la API key ni el token de prueba se escriben en logs, almacenamiento del móvil,
widget, URL, repositorio o bundle. El formulario los conserva solo en memoria.

Probar hace una petición pequeña (máximo 512 tokens de salida) sin datos del piso;
puede tener coste. Entrega un token aleatorio de un solo uso válido diez minutos,
ligado a usuario, sesión y HMAC de la configuración exacta. Guardar consume ese
comprobante sin volver a llamar al proveedor. Un fallo no reemplaza la conexión
anterior. Las pruebas pendientes se invalidan al borrar; las respuestas en vuelo
se descartan tras revocar/cambiar la conexión o cerrar la sesión. Una petición ya
enviada al proveedor puede haber consumido saldo antes de esa revocación.

Cinco pruebas/minuto por usuario, cincuenta/minuto globales; una prueba y una
consulta simultánea por usuario. Las consultas mantienen además el límite global
configurado por usuario (diez/minuto por defecto). No hay reintentos automáticos de
red ni fallback a claves globales o de otros usuarios. Una corrección de formato
puede requerir una segunda llamada del asistente. Cada llamada tiene límite de
30 segundos y respuesta de 128 KiB. El proveedor recibe solo el contexto autorizado
ya filtrado por AlarmaT. Los campos leídos siguen sujetos a revisión humana.

## Despliegue y recuperación

Generar UNA VEZ 32 bytes aleatorios hexadecimales en
`/etc/alarmat/ai-encryption.key`, root:root 0600. Instalar
`deploy/personal-ai.conf` como drop-in de `alarmat.service`; systemd entrega una
copia privada de lectura en su directorio de credenciales. La variable
`AI_CREDENTIAL_KEY_FILE` apunta a ese fichero separado de SQLite. Nunca regenerar
la clave en cada despliegue ni incluirla en backups de base de datos o artefactos.
Si falta, las funciones manuales siguen disponibles; probar/usar IA falla cerrado.
Las antiguas variables AI_API_KEY/OPENROUTER_API_KEY ya no se cargan en el asistente.

Conservar una copia segura de la clave separada de las copias SQLite: perderla hace
irrecuperables las conexiones guardadas y exige que cada usuario vuelva a conectar.
Una rotación requiere descifrar y volver a cifrar todas las filas en una operación
controlada, preservando la clave anterior hasta verificar la copia y la migración.
Borrar una conexión la retira de la base activa; las copias históricas cifradas
siguen la política de retención existente. No se reescriben backups de usuarios.

`npm run check` incluye aislamiento entre usuarios, cifrado vinculado al dueño,
revocación, caducidad, respuestas malformadas y ambos formatos de proveedor. La prueba
real optativa usa `RUN_LIVE_AGENT=true`, `AI_TEST_API_KEY`, `AI_TEST_PROVIDER` y
`AI_TEST_MODEL` en una base temporal. Nunca poner estas claves en argumentos CLI.

Referencias comprobadas el 24-10-2026:
- https://developers.openai.com/api/docs/guides/text
- https://opencode.ai/v2/docs/console/models/
- https://api-docs.deepseek.com/
- https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion
