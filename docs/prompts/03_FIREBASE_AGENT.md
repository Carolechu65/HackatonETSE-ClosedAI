# Persona 3 — Firebase, seguridad y agente

Copia el bloque «Prompt principal» completo en tu agente. Los tres subprompts finales son encargos delegables después de fijar los contratos; el agente tiene un subencargo enlazado al final. Sustituye únicamente los datos de entorno que conozcas; no pegues claves ni tokens.

## Prompt principal

```text
Actúa como responsable de backend, seguridad y agente de alarmaT. Implementa y verifica una entrega funcional; no te limites a redactar un plan. La app Android permite proponer alarmas a otras personas. Cada destinatario acepta, rechaza o elige otra hora; nadie puede consentir por él. Tu primera entrega demuestra que A crea una propuesta, B la consulta y responde, y C no puede acceder aunque comparta grupo. Entrega también el contrato y fixtures de salida estructurada de borrador o aclaración para «Recuérdale a Ana sacar la basura cuando vuelva», sin inventar la hora que falta. La implementación del agente sigue en la prioridad de producto P1, en una fase posterior según el alcance del plan; este prompt no la eleva a P0. Distingue contrato, simulación e integración real.

Estamos seis personas trabajando en paralelo. El reparto vigente es: P1 base/contratos/configuración/CI; P2 pantallas; P3 tú, Firebase/seguridad/agente; P4 runtime Android/notificaciones; P5 RNFirebase/SQLite/sincronización; P6 widgets/tareas/integración/demo. No estás solo: conserva cambios ajenos y no renombres interfaces unilateralmente. Este es el reparto original de START_HERE; conserva estas responsabilidades.

Lee AGENTS.md aplicables si existen; después README.md, FEATURES.md, docs/TDD.md, docs/FIREBASE_PRACTICES.md, contracts/README.md y los archivos que vas a modificar. Inspecciona git status antes de editar. Hoy functions/src/operations/alarms.ts contiene createAlarmRequest, respondToAlarm y reportSchedule, pero son stubs que devuelven unimplemented. functions/src/contracts/operation.ts valida solo un sobre incompleto. hasCurrentConsent es una condición parcial, no autorización. firebase/firestore.rules deniega todo. No confundas estos puntos de partida con backend operativo.

Tu ownership exclusivo: functions/src/operations/, functions/src/persistence/, functions/src/messaging/, functions/src/domain/, functions/src/contracts/, functions/src/agents/, firebase/ y sus pruebas. functions/src/persistence y messaging pueden necesitar crearse. Delega functions/src/agents/ siguiendo 03A_AGENT_SUBAGENT.md; tú mantienes su contrato con las operaciones protegidas. Solo tú editas functions/src/index.ts y los contratos del backend después de acordarlos: integra exports de forma serial y preserva proposeAlarm. Los contratos comunes en contracts/ y src/domain/alarms.ts se acuerdan con P1; no mantengas copias divergentes de los mismos DTO. P1 integra dependencias y lockfile de la app y CI. Como principal P3, integra serialmente functions/package.json, su lockfile y firebase.json; los subagentes te solicitan cambios concretos en esos archivos. P5 implementa los adaptadores del SDK cliente y Auth; P2 hace sus pantallas y la UI de assistant, coordinada contigo. Tú defines la autorización del servidor y el contrato de sesión/invitación.

Antes de paralelizar, fija una hoja breve de interfaces: payload válido/incorrecto por operación, ruta Firestore, códigos de error y fixtures de ejemplo. El sobre debe incluir schemaVersion, operationId estable, groupId, entityId cuando corresponda, expectedRequestVersion y expectedDecisionRevision. La identidad viene de request.auth.uid. Valida campos, límites, instantes UTC enteros, zona IANA, modo, pertenencia activa, destinatarios y caducidad; un cast TypeScript no valida entrada externa.

Respeta el modelo del TDD. Propuestas: groups/{groupId}/alarmRequests/{requestId}, con creatorUid y recipientUids consistentes. Respuestas: recipients/{uid}. Acuses: recipients/{uid}/schedules/{occurrenceId}, bajo la propuesta. Dispositivos: users/{uid}/devices/{deviceId}; principal y deviceEpoch en users/{uid}. Una lectura de bandeja usa recipientUids array-contains uid; enviados usa creatorUid == uid. Rules no filtra consultas amplias: prueba los queries reales e incluye los índices necesarios. El creador y ese destinatario pueden consultar su respuesta/acuse; pertenecer al piso no da acceso universal a propuestas privadas. Tokens, invitaciones y operaciones internas no se exponen a otros miembros.

Implementa en incrementos:
1. Reglas y fixtures A/B/C; bootstrap de grupo/invitación mediante operaciones autenticadas. Si primero usas datos sembrados en emulador, identifícalos como fixture, nunca como invitación terminada.
2. createAlarmRequest y respondToAlarm con transacciones, versiones e idempotencia. ACCEPTED no equivale a SCHEDULED. Una modificación del emisor aumenta requestVersion y exige revisar consentimiento. Cada decisión del destinatario aumenta decisionRevision. No aceptes hora pasada ni permitas que A decida por B.
3. registerDevice, setPrimaryDevice y reportSchedule para integrar P5. El acuse requiere destinatario, dispositivo principal y par vigente requestVersion/decisionRevision más deviceEpoch. Un acuse viejo no resucita una cancelación. Un estado reportado no prueba que el usuario haya oído sonido.
4. Evento de entrega persistido en la transacción y worker FCM. No envíes FCM dentro del callback transaccional, que puede repetirse. No prometas transporte exactly-once.

La operación idempotente se registra por usuario y operationId, guardando tipo, hash canónico del payload, resultado y versión del contrato junto con el cambio de dominio. Mismo ID/entrada devuelve el resultado anterior; mismo ID/entrada diferente falla. Gestiona la carrera entre dos invocaciones, no solo dos llamadas secuenciales. Autorización con Admin SDK se comprueba explícitamente; Admin no queda restringido por Rules. Deniega escrituras directas de cliente en estados protegidos.

La outbox del servidor es distinta de la outbox SQLite del cliente. La primera reparte eventos; la segunda reintenta comandos/ACK. El worker reclama y actualiza eventos con una estrategia reintentable. FCM transporta eventId, IDs y versión con contenido mínimo, nunca instrucciones para sonar. Puede duplicarse o llegar tarde. Retira tokens inválidos sin revelar tokens en logs. Entrega a P5 el formato notification/data y la política para no presentar dos veces el mismo aviso. Limita tamaños, destinatarios, frecuencia e instancias de demo de forma explícita.

Tu subagente de IA necesita herramientas autorizadas para consultar contexto y producir propuestas. Proporciónale servicios reutilizables con actor autenticado, validación y límites; no le entregues escritura Admin arbitraria ni una herramienta para aceptar por Ana. Confirmar el borrador por el emisor crea una propuesta normal. La aceptación de Ana sigue siendo otra operación. No ejecutes automáticamente instrucciones incrustadas en títulos/tareas.

Usa hasta tres subagentes con ownership disjunto tras acordar las interfaces: operaciones/dominio/persistencia, Rules/índices y messaging. Tú integras exports, contratos e invitaciones. El subencargo IA se ejecuta después de liberar un slot, según la capacidad disponible, y solo tras fijar las herramientas protegidas; no necesita un cuarto trabajador humano ni cambiar las prioridades del plan. Ningún par modifica el mismo archivo de tests o configuración. Si una dependencia aún no existe, usa un puerto falso explícito y una prueba de contrato, conservando pendiente la integración real.

Verifica con Node del repositorio: npm --prefix functions ci, npm --prefix functions run typecheck, npm --prefix functions run build. Crea scripts de pruebas significativos con P1 antes de citarlos como disponibles. Ejecuta Emulator Suite con proyecto local demo-alarmat para Auth/Firestore/Functions; no necesita credenciales productivas. Prueba Rules y handlers por separado. Si faltan Java, emuladores o configuración, registra el bloqueo exacto y sigue con pruebas puras; no declares la integración aprobada. FCM requiere proyecto real y teléfonos: un emulador verde no demuestra push.

No despliegues a un proyecto ambiguo. Cuando exista proyecto demo identificado y autorización vigente, usa --project explícito y limita recursos al alcance autorizado. No cambies facturación ni IAM por deducción. Nunca subas cuentas de servicio, secretos de modelos o tokens; no los imprimas. La configuración cliente no sustituye Rules.

Termina con un informe concreto: archivos, contratos que cambian, operaciones listas, comandos ejecutados/resultados, escenarios fallidos, evidencia de emulador y pendientes físicos. Entrega a P5 ejemplos de respuesta/errores/ACK; a P2 estados representables y contrato del asistente; a P1 contratos estables; a P6 recorrido y límites para la demo. No marques completados stubs. Sigue la política de integración acordada con P1, sin force-push ni incluir cambios ajenos.
```

## Matriz de aceptación

| Caso | Evidencia exigida |
|---|---|
| A crea, B consulta y responde | Integración de callable y lecturas autorizadas en emulador. |
| C es externo o miembro no destinatario | Lectura y mutación denegadas en ambos casos. |
| A intenta aceptar por B | Handler rechaza, sin escritura parcial. |
| Repetición concurrente / payload cambiado | Un efecto lógico / rechazo por reutilización inválida. |
| ACK de versión, revisión o epoch antiguo | No sobrescribe el estado vigente. |
| FCM falla tras guardar propuesta | Propuesta persiste; evento permanece reintentable. |
| Contrato agéntico sin horario | Fixture de aclaración estructurada; ninguna alarma ni consentimiento inventados. La llamada real al modelo se valida en la fase de prioridad P1, bajo responsabilidad de la persona 3. |

## Subprompt A — Operaciones, dominio y persistencia

```text
Implementa functions/src/operations/, functions/src/domain/, functions/src/persistence/ y sus pruebas en functions/tests/operations/ y functions/tests/persistence/. No estás solo; no edites Rules, messaging, agente, contratos ni exports compartidos. Consume las interfaces acordadas. Valida identidad, pertenencia y transiciones de crear/responder/reportar. Persiste dominio, resultado idempotente y evento outbox juntos. Prueba concurrencia, mismo ID con distinto payload y versiones viejas. No envíes FCM dentro de transacciones. Entrega diff y evidencia real de pruebas al principal; no hagas push.
```

## Subprompt B — Rules y consultas

```text
Implementa firebase/firestore.rules, firebase/firestore.indexes.json y pruebas aisladas en firebase/tests/. No estás solo; no cambies handlers, lockfiles ni CI. Deniega por defecto y prueba consultas recipientUids/creatorUid, documento individual, recipients/schedules, membresía retirada, tokens privados y escrituras directas. C puede compartir grupo y seguir sin acceso a A→B. Solicita dependencias de test al principal. Entrega comandos reproducibles y resultados reales; no declares las reglas seguras solo porque compilan y no hagas push.
```

## Subprompt C — Messaging y outbox servidor

```text
Implementa exclusivamente functions/src/messaging/ y functions/tests/messaging/ con puertos acordados para reclamar eventos y registrar resultados. No estás solo; no edites persistencia, operaciones, contratos, exports o configuración. Envía FCM después de la transacción de dominio, con eventId, IDs y versión. Prueba reintentos, token inválido y caída tras enviar antes de registrar éxito; documenta la posibilidad de duplicados. No incluyas contenido privado innecesario. Entrega payload a P5 y resultados al principal. Emuladores y mocks no prueban entrega FCM real. No hagas push.
```

## Subencargo IA de la persona 3

Cuando estén fijadas las herramientas autorizadas y haya un slot disponible, copia el [prompt específico del subagente agéntico](03A_AGENT_SUBAGENT.md). Su ownership es `functions/src/agents/` y pruebas propias; P3 integra contratos/exports, P2 desarrolla la interfaz y P6 prepara la demo. El recorrido debe distinguir aclaración, borrador confirmado por el emisor, propuesta y consentimiento del destinatario. No convierte al subagente en una séptima persona ni habilita alarmas unilateralmente.
