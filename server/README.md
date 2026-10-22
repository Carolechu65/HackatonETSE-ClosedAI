# API SQLite de alarmaT

Servidor funcional Node 22 / Fastify / better-sqlite3. No requiere Firebase ni ofrece acceso SQL desde el móvil. Los contratos y validadores de `../src/domain/` son la única definición de comandos de alarma.

```sh
npm --prefix server ci
npm --prefix server run typecheck
npm --prefix server test
npm --prefix server run build
npm --prefix server run migrate
npm --prefix server run dev
```

Usar Node 22. En este VPS también se verificó con `npx --yes --package=node@22 -c 'npm --prefix server test'`. `dev`, `migrate` y `start` se ejecutan con directorio de trabajo `server/` mediante npm. La DB predeterminada está en `server/data/alarmat.db`; configurar `DATABASE_PATH` absoluto en despliegue. No se ha desplegado producción.

## HTTP para P2/P5/P6

JSON, bearer exclusivamente en cabecera `Authorization`. Error sin wrapper: `{code,message,retryable,serverTimeEpochMs,details?}`. `400 INVALID_ARGUMENT`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 VERSION_CONFLICT/DEVICE_NOT_PRIMARY`, `410 EXPIRED`, `429 RATE_LIMITED`, `503 TEMPORARY_UNAVAILABLE`.

| Ruta | Entrada → salida |
|---|---|
| POST `/v1/auth/register` | `{email,password,displayName?}` → `{userId,token,expiresAtEpochMs}` |
| POST `/v1/auth/login` | `{email,password}` → misma sesión |
| GET `/v1/auth/me` | → `{userId,email,displayName}` |
| POST `/v1/auth/logout` | → `{ok:true}`; revoca inmediatamente |
| GET `/v1/groups` | → `{groups:[{id,name,timeZone,role}]}` |
| POST `/v1/groups` | `{name,timeZone?}` → grupo; zona predeterminada Europe/Madrid |
| GET `/v1/groups/:groupId/members` | → `{members:[{userId,displayName,role}]}` |
| POST `/v1/groups/:groupId/invitations` | `{maxUses?:1..6}` → `{token,expiresAtEpochMs}`; solo owner; 24 h |
| POST `/v1/invitations/accept` | `{token}` → grupo; consumo atómico |
| DELETE `/v1/groups/:groupId/members/:userId` | → `{ok:true}`; owner elimina o miembro sale; owner permanece |
| GET `/v1/groups/:groupId/alarm-requests` | → `{alarms:AlarmRecord[]}`; alias `/alarms`; incluye enviadas y recibidas, nunca las de terceros |
| POST `/v1/operations/:kind` | `OperationEnvelope` existente → `OperationReceipt` existente |
| GET `/v1/sync?cursor=...` | `SyncPage` exacta de P5; cursor opaco por usuario |
| POST `/v1/devices` | `{deviceId,platform:'android'|'ios'|'web',pushToken?}` → `{deviceId,platform}` |
| POST o PUT `/v1/devices/primary` | `{deviceId}` → `{deviceId,deviceEpoch}` |
| GET `/v1/groups/:groupId/tasks` | → `{tasks:HouseholdTask[]}` |
| POST `/v1/groups/:groupId/tasks` | `{operationId,title,assigneeUid?,activateAtEpochMs?,dueAtEpochMs?}` → `HouseholdTask` |
| POST o PATCH `/v1/groups/:groupId/tasks/:taskId` | `{operationId,status:'completed'|'cancelled',expectedVersion}` → `HouseholdTask` |
| POST `/v1/agent/draft` | `{groupId,text,conversationId?}` → aclaración o borrador |

Contraseñas: 10–256 caracteres, Argon2id. Sesiones opacas de 32 bytes aleatorios, hash SHA-256 persistido, 7 días por defecto (`SESSION_DURATION_MS`); sin refresh. `displayName` máximo 80. El token no viaja en los DTO de grupos ni se registra. Cliente guarda la sesión en SecureStore. CORS requiere `CORS_ORIGINS` con lista explícita separada por comas; no acepta cualquier origen.

Operaciones: `createAlarmRequest`, `respondToAlarm`, `withdrawAlarmRequest`, `reportSchedule`. Conservar `operationId` al reintentar; mismo actor/ID y contenido distinto devuelve conflicto. Crear devuelve `result.requestId`. Responder solo admite la identidad destinataria autenticada. Aceptar incrementa `decisionRevision`, nunca declara programación. Solo un ACK del dispositivo principal, epoch/versiones vigentes y ocurrencia consentida puede declarar `SCHEDULED`. Un ACK antiguo no revive una retirada. Las tareas terminadas retiran propuestas vinculadas dentro del mismo commit; no esperan un ACK para declarar la tarea terminada, y la retirada local queda pendiente hasta sincronizar.

`AlarmRecord = {groupId,requestId,request,recipient,primaryDevice,schedules}`. Las alarmas enviadas con varios destinatarios se devuelven una vez por destinatario en la lista. El feed está destinado a la copia propia del destinatario. Página: `{events:[{eventId,kind:'upsert',alarm}|{eventId,kind:'revoke',groupId,requestId?}],nextCursor,hasMore,serverTimeEpochMs}`. Sin cursor recorre eventos retenidos usando proyecciones actuales y consistentes; cada página es una transacción. Cursor de 7 días: `EXPIRED` requiere reiniciar instantánea. La pertenencia se revalida incluso al reproducir idempotencia o cambios viejos. No hay SSE; el polling foreground es la integración operativa.

Ejemplo válido de aceptación:

```json
{"schemaVersion":1,"operationId":"accept-123","groupId":"group-id","entityId":"request-id","expectedRequestVersion":1,"expectedDecisionRevision":1,"payload":{"decision":"ACCEPTED","consentScope":"THIS_OCCURRENCE"}}
```

Añadir `actorUid` o aceptar sin `consentScope` es inválido; cambiar `expectedDecisionRevision` a una revisión vieja da conflicto. Los fixtures compartidos de `contracts/fixtures/` describen los demás mensajes.

## Asistente real

Configurar `OPENROUTER_API_KEY` fuera del repositorio y `OPENROUTER_MODEL` con un modelo autorizado en la cuenta. Integración con [OpenRouter Chat Completions](https://openrouter.ai/docs/api_reference/overview), formato JSON, 900 tokens de salida, 20 s de timeout, máximo seis turnos y conversación de 30 minutos. El contexto se obtiene exclusivamente de miembros y tareas del grupo autorizado. No tiene herramientas de mutación ni aceptación. Se valida el borrador con los mismos validadores del formulario y se revalida pertenencia tras la llamada.

Respuesta de aclaración: `{conversationId,status:'needs_clarification',question,missingFields:string[]}`. Respuesta de borrador: `{conversationId,status:'draft',draft:CreateAlarmRequestPayload,requiresSenderReview:true,requiresRecipientConsent:true}`. El emisor revisa y envía por `createAlarmRequest`; el destinatario consiente por separado. Sin proveedor, se devuelve error explícito y sigue disponible el formulario manual; nunca se presenta un fixture como IA real.

Prueba real completada con `deepseek/deepseek-v4.1-flash`: «cuando vuelva» produjo aclaración; el seguimiento con fecha/hora/modo produjo borrador validado para Ana, sin crear alarmas. Dos llamadas sintéticas (~3,5 s en esta ejecución). El intento inicial con otro modelo devolvió restricciones de guardrail; no se alteraron esas restricciones. El modelo actual fue elegido por el usuario. Los tests deterministas usan adaptador falso etiquetado. Repetir prueba real opt-in, solo con datos sintéticos:

```sh
cd server
RUN_LIVE_AGENT=true node --env-file=/ruta/privada/openrouter.env --import tsx --test test/agent.test.ts
```

## Persistencia, push y operación

SQLite WAL, foreign keys, busy timeout 5 s, synchronous FULL, migraciones exclusivas y numeradas. Archivo modo 0600, directorio nuevo modo 0700. Un único proceso escritor. Ninguna transacción contiene red o `await`. `operations`, cambios y outbox persisten con el efecto. Outbox: lease de 60 s, backoff hasta 1 h, reintentos recuperables; duplicados tolerados. Push manda solo IDs/versiones, jamás una orden de sonar. Tickets/receipts invalidan tokens no registrados. Se activa únicamente con `EXPO_PUSH_ENABLED=true`; Expo/FCM y prueba física siguen pendientes. Un push o ACK de programación no demuestra audio oído.

Plantillas `deploy/alarmat.service`, `deploy/nginx.conf` y `.env.example`; sustituir rutas, dominio y certificados explícitamente. No ejecutar con root. Volumen local persistente y privado fuera del webroot, HTTPS y proceso supervisado. El rate limit usa la IP del socket; detrás del proxy comparte cupo entre clientes hasta configurar de forma segura la frontera de proxy de confianza.

Backup consistente con Online Backup API y restauración verificada por `integrity_check`:

```sh
npm --prefix server run backup -- /ruta/privada/backups/alarmat-2026-10-22.db
```

Programar diariamente, conservar al menos siete copias diarias y cuatro semanales y replicar a almacenamiento privado fuera del VPS mediante el mecanismo del operador. El comando no copia solo el `.db` abierto ni borra copias. Para restaurar: detener el proceso; verificar la copia en un archivo separado; conservar la DB actual junto con WAL/SHM en una ubicación privada; instalar el archivo de backup y arrancar la versión de aplicación compatible con su esquema. No borrar una DB para arreglar migraciones. Rollback de aplicación solo a versión compatible; una migración destructiva requiere una nueva migración de recuperación o restauración controlada, nunca downgrade implícito.

Evidencia local: typecheck, build, tres suites con SQLite temporal, concurrencia por HTTP inject, consentimiento/privacidad A/B/C, versiones/epoch y cancelación, idempotencia, caducidad/revocación, tareas, feed, outbox/receipts simulados, reinicio y backup. Falta desplegar HTTPS y ejecutar el recorrido entre dos teléfonos. No hay OAuth, recuperación de contraseña, edición de términos de propuesta, ni garantía física de Android en este módulo.
