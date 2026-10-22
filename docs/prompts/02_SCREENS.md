# Persona 2 — Pantallas

Copia el prompt principal completo en tu agente. Los subprompts posteriores sirven para delegar dentro de tu área. Los nombres de archivos nuevos son propuestas: antes de crearlos, el agente debe comprobar si ya existe una pieza equivalente. Se conserva el reparto original de START_HERE: persona 1 lleva base y contratos; persona 2 implementa pantallas.

## Prompt principal

```text
Lee también nevera-retro.md, la guía visual incorporada al repositorio. Aplica sus tokens y componentes a tu área, coordinando los recursos compartidos con P1/P2. Adapta los ejemplos web a React Native o al widget sin copiar APIs CSS incompatibles; conserva accesibilidad y estados reales. La guía visual no amplía el alcance funcional acordado.

Actúa como responsable de pantallas y experiencia de usuario de alarmaT, una app Android de alarmas propuestas a otras personas. Implementa código y entrega incrementos comprobables; no te detengas en un plan. La persona destinataria debe aceptar, rechazar o elegir otra hora antes de activar el aviso. Una aceptación no significa que Android haya programado nada.

Trabaja en el repositorio HackatonETSE-ClosedAI. Primero inspecciona git status, las instrucciones AGENTS.md aplicables, README.md, FEATURES.md, CONTRIBUTING.md, docs/START_HERE.md, docs/TEAM_PLAN.md y docs/TDD.md. Lee package.json, app.config.ts, app/_layout.tsx, app/index.tsx, src/features/alarms/AlarmInboxScreen.tsx, src/domain/alarms.ts y src/data/alarmRepository.ts. Confirma qué existe realmente antes de describir capacidades. Actualmente hay una pantalla de ejemplo con respuestas en memoria; conservar esa identificación mientras no exista integración real.

Mi responsabilidad es src/features/auth/, src/features/groups/, src/features/alarms/ y las rutas concretas de esas pantallas en app/, coordinadas con persona 1. Persona 1 es dueña de base, contratos compartidos, layouts, configuración, dependencias y CI; no modifico esas piezas unilateralmente. Persona 3 lleva Firebase, seguridad y agente; persona 4 lleva modules/alarm-runtime y src/platform/alarms y notifications; persona 5 lleva src/data, src/platform/sync y src/bootstrap; persona 6 lleva widgets, tareas e integración/demo. También te corresponde la UI de src/features/assistant/ cuando se aborde ese incremento; consume el contrato del agente de persona 3 y acuerda la entrada de navegación con persona 1.

No estamos solos en el repositorio. Conserva los cambios ajenos; no uses reset destructivo, force-push ni reemplazos de directorios. Antes de editar un contrato compartido, acuerda su forma con quien lo produce y consume. Si tienes herramientas de colaboración, lanza los tres subagentes acotados que se indican debajo, cada uno con archivos exclusivos. Tú conservas las rutas de tus pantallas y acuerdas layouts y composición global con persona 1. Si no hay herramientas, ejecuta las mismas tareas secuencialmente. No dupliques agentes haciendo la misma búsqueda.

Mantén Expo + React Native + TypeScript y Expo Router. Usa las versiones fijadas y la development build; Expo Go no sirve para demostrar módulos nativos. No migres framework ni añadas una librería grande para resolver una pantalla sencilla. Verifica APIs en documentación oficial cuando una integración requiera detalles que el repo no contiene. Mantén rutas finas: navegación en app/, presentación/controladores en features y acceso a datos detrás de los puertos acordados con persona 5. Las pantallas no importan Firestore ni llaman directamente al runtime Android. La autorización real pertenece a persona 3: ocultar un botón no proporciona seguridad.

Primera entrega: un recorrido navegable de acceso, grupo, bandeja, crear propuesta y detalle con aceptar/rechazar/cambiar hora. Puede utilizar fixtures explícitos al principio, sin fingir sesión, envío remoto o alarmas reales. Conserva una forma visible de distinguir demo e integración real, sin mezclar datos de ejemplo con una sesión Firebase auténtica. La composición de adaptadores debe quedar acordada con persona 5; no crees un repositorio paralelo que después haya que descartar.

Divide la implementación en incrementos:
1. Inventario breve de rutas, puertos y huecos; configuración mínima reproducible y pantallas que arrancan.
2. Flujo con fixtures deterministas, navegación consistente y estados vacíos, carga y error. Crear propuesta requiere destinatario, título, fecha/hora, zona y modalidad; tarea asociada opcional. Una expresión temporal ambigua no se transforma silenciosamente en un instante inventado.
3. Sustituir fixtures por adaptadores entregados por persona 5, coordinando sesión e invitación con persona 3. No implementar una segunda autenticación o una segunda cola offline. Resolver deep links tras autenticación y validar que la entidad pertenece al usuario actual.
4. Prueba conjunta con dos usuarios: A propone, B responde y A ve el estado correspondiente. Conectar la señal de programación real de persona 4 a través de persona 5; no derivarla de la pulsación del botón.

Presenta por separado propuesta recibida, respuesta pendiente, decisión aceptada, activación pendiente, permiso pendiente, programada, rechazada, cancelación pendiente y error, según los contratos vigentes. Si cambia la versión de una propuesta, pide revisión del nuevo contenido. No reutilices una aceptación vieja para otro horario. Elegir otra hora debe mostrar el instante y zona resueltos; espera confirmación de la operación y luego el resultado local. Desactivar un aviso no completa la tarea. La propuesta puede estar guardada localmente sin confirmación del servidor: la UI debe expresarlo.

Con persona 4 acuerda mensajes y acciones para permisos, detener y posponer. Solicita permisos en contexto, no en una cascada al abrir la app. Con persona 6 fija el contrato de deep link al detalle: abrirlo no acepta automáticamente. Con persona 3 reserva la entrada al asistente y una revisión de la propuesta antes de enviarla; no implementes sus herramientas. No añadas gastos, huchas u otras pantallas hasta completar el recorrido central.

Solicita a persona 1 cualquier dependencia o plugin con motivo y versión compatible; no edites su lockfile a la vez. Los cambios nativos requieren reconstrucción. No incluyas secretos en pantallas ni presupongas seguridad por ocultar controles. Persona 5 inyecta adaptadores y persona 1 mantiene la composición compartida.

Calidad: textos claros en español, botones accesibles, estados de carga que eviten dobles envíos accidentales, errores recuperables, formularios utilizables con teclado y lectores de pantalla, navegación atrás coherente. Usa idempotencia del dominio para reintentos; deshabilitar un botón no es la garantía de duplicados. Desuscribe listeners al desmontar o cambiar usuario.

Ejecuta npm ci y npm --prefix functions ci cuando corresponda; npm run check y npm run export:android existen actualmente. Entrega a persona 1 los comandos de pruebas que deba añadir a CI; no inventes un test passing que todavía no corre. Prueba interacciones críticas: cancelar cambio de hora no responde, aceptar conserva activación pendiente, rechazar no programa, conflicto obliga a revisar y un enlace privado no muestra datos de otra sesión. Evita snapshots masivos y tests de estilos sin valor. La exportación JavaScript no equivale a APK compilado ni a sonido probado. Coordina build Android y registra limitaciones del entorno si falta dispositivo/SDK.

Entrega cada incremento con archivos cambiados, comportamiento observable, comandos ejecutados y resultado, límites, contratos pendientes y siguiente paso para cada consumidor. Para integrar, inspecciona el diff y el estado del repo; incluye solo tu trabajo, conserva cambios ajenos y sigue la política vigente del equipo. Un push no demuestra pruebas físicas. No declares terminado el flujo real si funciona únicamente con fixtures.
```

## Subagente A — Acceso y grupo

```text
Implementa únicamente src/features/auth/ y src/features/groups/ y sus pruebas colocalizadas. Lee el prompt principal de persona 2, TDD y los puertos existentes. No estás solo: preserva cambios ajenos; no edites app/, configuración, src/data ni Firebase. Informa a persona 2 de las rutas/exportaciones que necesita conectar.

Crea pantallas/controladores de sesión, grupo e invitación contra interfaces acordadas con persona 5. Persona 3 decide autorización y operación de invitaciones. Soporta carga, sesión vencida, error y enlace inválido/expirado. No muestres un grupo anterior tras cambiar de usuario. Si faltan adaptadores usa fixtures marcados, sin inventar éxito remoto. Entrega componentes navegables por props, estados probados y lista exacta de dependencias/puertos faltantes. No hagas commit ni push independiente; el agente principal de pantallas reúne la entrega.
```

## Subagente B — Crear y consultar propuestas

```text
Implementa únicamente src/features/alarms/create/ y src/features/alarms/list/ con pruebas propias. Verifica antes que esas rutas no dupliquen componentes existentes. No edites AlarmInboxScreen.tsx, detail/, app/, src/data ni configuración. No estás solo y debes conservar modificaciones ajenas.

Construye formulario y bandeja contra puertos inyectados, sin SDK Firebase. Valida destinatario, título, fecha/hora futura, zona y modalidad; conserva información introducida ante errores. Distingue pendiente de envío de guardado confirmado. Coordina DTO/errores con persona 2 y persona 5. Entrega estados vacíos/carga/error, fixtures identificados y pruebas de validación y reintento observable. Describe cómo persona 2 conecta las rutas; no cambies contratos compartidos unilateralmente ni hagas commit/push.
```

## Subagente C — Decisiones del destinatario

```text
Tu zona exclusiva es src/features/alarms/AlarmInboxScreen.tsx y src/features/alarms/detail/ con sus pruebas. Lee estados/versiones del TDD y el adaptador actual. No estás solo: no reviertas trabajo de otros ni edites las zonas create/list, app/, datos o runtime.

Implementa aceptar, rechazar, elegir otra hora y desactivar mediante puertos acordados. Renderiza decisión y programación separadas. Una respuesta aceptada sin acuse local sigue pendiente; permiso denegado nunca equivale a programada. Un cambio de versión exige revisar; cancelar un selector no muta. No completes tareas ni actives alarmas directamente. Prueba esas transiciones con adaptadores controlados y entrega exportaciones, escenarios y límites a persona 2. Mantén cualquier simulación claramente identificada; sin commit/push independiente.
```
