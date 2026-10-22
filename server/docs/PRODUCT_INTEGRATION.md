# Integración P2/P5/P6 sobre el servidor canónico

Se conserva la implementación de main: un proceso Fastify, una SQLite, migración `001_init.sql`, servicios, proveedor intercambiable y suites originales. La migración `002_product_integration.sql` amplía tareas, conversaciones y proyección móvil; no cambia el checksum de la migración 001 ni requiere borrar datos. La implementación paralela previa está preservada en el commit `c8da5a5`; no queda un segundo servidor activo en el árbol.

## Contratos de composición

Auth conserva la respuesta canónica de registro/login `{token,expiresAtEpochMs,user:{uid,email,displayName,primaryDeviceId,deviceEpoch}}`. El codec móvil transforma `user.uid` a `AuthSession.userId`. `/auth/me` devuelve `{user,session:{expiresAtEpochMs}}`.

Grupos: GET `{groups:[{groupId,name,timeZone,role:'OWNER'|'MEMBER',memberCount}]}`; POST `{name,timeZone}` devuelve `{groupId}`. Miembros: `{members:[{uid,displayName,role}]}`. Invitación creada `{invitationId,token,expiresAtEpochMs}`, de un uso. Aceptación canónica `/v1/invitations/:token/accept` y alias `/v1/invitations/accept` con `{token}` devuelven `{groupId,alreadyMember}`. El alias evita poner secretos en URL; los logs redactan la ruta histórica.

`GET /v1/groups/:groupId/alarm-requests` conserva la lista original. La UI nueva usa `/v1/groups/:groupId/alarms`: `{alarms:AlarmRecord[]}`. Una propuesta enviada con varios destinatarios devuelve una fila por destinatario, con sus acuses; únicamente el creador puede leer las filas de otros destinatarios. `AlarmRecord={groupId,requestId,request,recipient,primaryDevice,schedules}`.

`GET /v1/sync` conserva el feed de entidades de main. P5 solicita `GET /v1/sync?projection=alarms` y añade `&cursor=...` al continuar. Respuesta exacta: `{events:[{eventId,kind:'upsert',alarm}|{eventId,kind:'revoke',groupId,requestId?}],nextCursor,hasMore,serverTimeEpochMs}`. Es la proyección propia del destinatario; la UI refresca enviados mediante `/alarms`. Los triggers traducen cambios del journal canónico a IDs de proyección, incluidos cambios de dispositivo y reingreso al grupo. No copian contenido de alarmas ni sincronizan archivos SQLite. Cada página relee autorizaciones y DTO actuales en transacción. Cursores aleatorios ligados al usuario, caducidad de siete días; el cliente debe reiniciar la instantánea al recibir `EXPIRED`. Un token con formato válido que ya fue purgado o no pertenece a la sesión también devuelve `EXPIRED` de forma indistinguible, sin revelar existencia ni propietario; los malformados siguen dando `INVALID_ARGUMENT`. El reinicio desde cursor nulo conserva revocaciones del journal. Retirada de membresía genera revocación e invalida consentimiento; reingreso no vuelve a aceptar automáticamente.

El HTTP canónico conserva `EXPIRED=409` y `DEVICE_NOT_PRIMARY=403`. El adaptador P5 debe conservar esos códigos del cuerpo validado al traducir estados; no convertir indiscriminadamente todos los 409 a conflicto de versión o todos los 403 a FORBIDDEN.

`POST /v1/devices/primary {deviceId}` es alias del endpoint por ID. Marcar el mismo dispositivo principal es idempotente y no incrementa epoch; cambiarlo sí. Registro inicial ya lo marca principal si no existía otro.

Tareas:

- GET `/v1/groups/:groupId/tasks` → `{tasks:HouseholdTask[]}`.
- POST misma ruta `{operationId,title,assigneeUid?,activateAtEpochMs?,dueAtEpochMs?}` → `HouseholdTask`.
- POST/PATCH `/v1/groups/:groupId/tasks/:taskId` `{operationId,status:'completed'|'cancelled',expectedVersion}` → `HouseholdTask`.

`HouseholdTask` coincide con P6: `{id,groupId,title,assigneeUid,createdByUid,activateAtEpochMs,dueAtEpochMs,status,version,completedByUid,completedAtEpochMs}`. Reintentos guardan el resultado en `operations`; reutilizar ID con otra entrada falla. Completar/cancelar retira alarmas vinculadas y persiste outbox/cambios en la misma transacción. El acuse de cancelación del dispositivo permanece independiente de la tarea completada.

## Chat con OpenRouter

El alias `POST /v1/agent/draft {groupId,text,conversationId?}` usa el mismo orquestador/proveedor que `/v1/agent/propose`, no un segundo agente. Respuesta: `{conversationId,status:'needs_clarification',question,missingFields}` o `{conversationId,status:'draft',draft:CreateAlarmRequestPayload,requiresSenderReview:true,requiresRecipientConsent:true}`. No crea propuestas ni consiente por nadie. Tras revisar, el emisor envía `createAlarmRequest`; el destinatario responde después.

`OPENROUTER_API_KEY` y `OPENROUTER_MODEL=deepseek/deepseek-v4.1-flash` configuran el proveedor OpenAI-compatible existente. `AI_PROVIDER` explícito prevalece; para usar esos aliases quitar `AI_PROVIDER=none` o cambiarlo a `openai`. Los parámetros `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` explícitos también prevalecen. La clave reside fuera del repositorio. El modelo fue elegido por el usuario tras un rechazo del guardrail de otro modelo; no se cambiaron restricciones del proveedor.

Límites: seis turnos por conversación, caducidad de 30 minutos por defecto, 900 tokens por llamada, máximo dos intentos de corrección estructurada; timeout configurado. Para el modelo DeepSeek elegido se desactiva razonamiento (`reasoning.effort=none`, soportado por su catálogo OpenRouter), reservando el límite para JSON visible. El proveedor resuelve la hora civil mediante el dominio después de leer JSON, evitando delegar el cálculo de epoch al modelo. Nombres/tareas son datos no confiables, el contexto excluye al emisor de los destinatarios y se revalida membresía tras la red. Fallo explícito mantiene disponible el formulario manual. El proveedor determinista legado permanece etiquetado para tests/demo; no se presenta como IA real.

Prueba opt-in real con datos sintéticos, después del build, desde `server/`:

```sh
RUN_LIVE_AGENT=true node --env-file=/ruta/privada/openrouter.env --test dist/server/test/agent-live.test.js
```

`CORS_ORIGINS` exige una lista explícita de orígenes separados por comas. En local usar `HOST=127.0.0.1`; esta integración no expone ni despliega un servicio público. Las plantillas de despliegue y backup canónicas permanecen vigentes. Las pruebas físicas de push/Android siguen separadas de los tests HTTP/SQLite.

## Evidencia de integración local

Node 22.23.4: build/typecheck correctos; suite canónica más producto/P5, 25 pruebas aprobadas y la prueba de proveedor real omitida por defecto. Prueba adicional Online Backup API + restauración/integrity_check/FK rollback aprobada. Prueba real opt-in del agente canónico con DeepSeek, 1/1 aprobada (~3,7 s, aclaración y borrador en dos llamadas). `npm run dev` usa `--experimental-transform-types` para las propiedades de constructor TypeScript existentes; imports de desarrollo verificados. El runtime Android usado por la integración P5 es falso explícito: estas pruebas no acreditan sonido físico, entrega push ni un despliegue HTTPS.

## Auditoría de despliegue 2026-10-22

Migración 003: las tareas admiten `description?: string|null` (máximo 2000) y `category?: string|null` (máximo 80) al crearlas y las devuelven como campos nulos o texto en sus DTO. No cambia el contrato de versiones, idempotencia o retirada de alarmas vinculadas. Las migraciones publicadas 001/002 no se modifican.

La API aplica ahora un límite agregado por usuario a todas las mutaciones autenticadas, incluidos grupos, invitaciones y dispositivos. Ambos endpoints de agente rechazan respuestas si la sesión ha caducado o fue revocada mientras se consultaba al proveedor.
