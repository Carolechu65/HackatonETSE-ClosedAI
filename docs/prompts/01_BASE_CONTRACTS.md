# Persona 1 — Base, contratos e integración técnica

Copia el prompt principal y entrega los subprompts a agentes separados. Conservamos el reparto original de START_HERE: esta persona habilita el trabajo de las demás y mantiene compilación y contratos; las pantallas pertenecen a persona 2.

## Prompt principal

```text
Lee también nevera-retro.md, la guía visual incorporada al repositorio. Aplica sus tokens y componentes a tu área, coordinando los recursos compartidos con P1/P2. Adapta los ejemplos web a React Native o al widget sin copiar APIs CSS incompatibles; conserva accesibilidad y estados reales. La guía visual no amplía el alcance funcional acordado.

Actúa como responsable de base técnica, contratos y configuración de alarmaT. Implementa incrementos concretos y verificables; no te limites a recomendar una estructura. El producto permite proponer alarmas a otras personas: únicamente el destinatario acepta, rechaza o elige otra hora. Aceptación y programación local son hechos diferentes. Nuestro stack es Expo, React Native, TypeScript y API HTTPS con SQLite en el VPS, con runtime Kotlin acotado para alarmas Android y widgets mediante la integración compatible acordada.

Primero inspecciona git status e instrucciones AGENTS.md aplicables. Lee README.md, FEATURES.md, CONTRIBUTING.md, docs/START_HERE.md, docs/TEAM_PLAN.md y docs/TDD.md. Revisa package.json, package-lock.json, .nvmrc, tsconfig.json, app.config.ts, index.ts, app/_layout.tsx, src/domain/alarms.ts y contracts/. Confirma qué archivos y scripts existen: la estructura inicial no demuestra integración con el VPS, programación real ni un widget instalado. No declares pruebas ejecutadas por leer que alguien las ejecutó antes.

Tu zona principal es configuración raíz de la app, dependencias y lockfile cliente, layouts/composición de navegación compartidos, src/domain/, contracts/ y CI. Persona 2 posee pantallas auth/groups/alarms y sus rutas de feature; acuerda con ella navegación y deep links sin editar sus componentes. Persona 3 posee API HTTPS, SQLite del VPS, seguridad y agente, incluyendo dependencias y configuración interna del backend; persona 4 posee runtime Android y notificaciones; persona 5 posee datos, sincronización y bootstrap; persona 6 posee widgets, tareas e integración/demo. No dupliques su trabajo para acelerar una demo.

No estamos solos en el repositorio. Conserva cambios de otros, no hagas reset destructivo ni force-push, no reemplaces archivos compartidos sin inspeccionar el diff. Delegación solicitada: usa tres subagentes con ownership exclusivo, contratos, navegación base y CI. Tú mantienes package.json, lockfile, app.config.ts y coordinación transversal. Si no dispones de subagentes ejecuta las mismas tareas secuencialmente. No hagas que dos agentes editen el mismo esquema o configuración.

Primera entrega: una development build reproducible que carga la base Expo y un conjunto mínimo de contratos/fixtures acordados con personas 3, 4 y 5. Expo Go no demuestra el runtime nativo. npm run export:android valida empaquetado JavaScript, no Kotlin ni sonido. Si no hay SDK/dispositivo, completa lo verificable, identifica exactamente el bloqueo y deja los comandos necesarios; nunca finjas la evidencia física.

Fija las versiones compatibles que ya declara el repo y comprueba el entorno Node. No hagas una actualización amplia del framework. Recibe de cada responsable una solicitud concreta de dependencia/plugin, verifica compatibilidad y aplica cambios compartidos serializadamente. Usa el instalador Expo cuando corresponda. Mantén un único cliente fetch/HTTPS mediante los adaptadores de P5. El backend objetivo será Node 22 + Fastify + better-sqlite3 en server/; P3 lo implementará. No instales Firebase JS SDK, RNFirebase ni Admin SDK. Coordina con P3 la URL pública de la API y con P5 expo-sqlite y expo-secure-store; las sesiones opacas bearer se guardan en SecureStore, nunca en fixtures ni logs. SQLite del VPS y SQLite local son bases distintas. La app nunca abre el archivo remoto ni recibe credenciales del VPS. Las claves de modelos van al servidor.

Contratos primero, pero solo los necesarios para la siguiente entrega. Define entradas/salidas, validación runtime, ejemplos válidos e inválidos y errores estables para crear propuesta, responder y reportar programación. Conserva operationId, schemaVersion, groupId, entityId, requestVersion, decisionRevision, deviceId, deviceEpoch y occurrenceId donde corresponda. Un tipo TypeScript no valida datos externos. No uses un booleano active para mezclar red, consentimiento y runtime. Coordina qué DTO pertenece a servidor, dominio, proyección de UI y store local; no conviertas accidentalmente AlarmSummary del scaffold en el contrato de seguridad.

Especifica el significado de cada confirmación: guardado en servidor, recibido por el dispositivo, respuesta aceptada y programación local confirmada. Los reintentos conservan identidad y no duplican operaciones. Una cancelación remota permanece pendiente hasta acuse local. Una versión nueva puede invalidar consentimiento anterior. Los fixtures deben permitir a persona 3 probar autorización/versiones, a persona 4 validar comandos nativos y a persona 5 reconciliar resultados sin adivinar semántica.

Tiempo: instantes UTC en milisegundos, zona IANA y hora local cuando sea necesaria. Reutiliza la política del TDD para recurrencia y horario estacional; fija ejemplos compartidos con resultados esperados, sin implementar tres algoritmos incompatibles. Prioriza una alarma puntual de extremo a extremo antes de expandir contratos. Gastos/huchas no son requisito para cerrar el recorrido central.

Organización: rutas finas, features con presentación/controladores, dominio puro y adaptadores fuera de componentes. Evita un monorepo o un framework interno innecesario. Centraliza solo contratos realmente compartidos. No crees veinte carpetas vacías. Acuerda un mecanismo sencillo para consumir fixtures/esquemas desde app, backend y pruebas Android, compatible con sus compiladores; no importes accidentalmente código React en server/. Cada ruptura de contrato debe actualizar productores, consumidores y ejemplo en la misma entrega coordinada.

Conserva un punto de entrada que permita a persona 5 inicializar sesión y listeners de sincronización antes de consumir las rutas. Tú no implementas recepción de push dentro de index.ts. La base sincroniza al abrir/reanudar; Expo Push Service con expo-notifications es opcional y se coordina con P3/P5. En Android requiere credenciales FCM como transporte, sin incorporar Firebase como backend. No presupongas tareas JS garantizadas en segundo plano. Acuerda layouts y deep links con personas 2 y 6: abrir una propuesta no acepta nada; una sesión incorrecta no puede mostrar la entidad anterior. Los plugins y permisos Android acordados con persona 4 deben sobrevivir prebuild; documenta qué se genera y qué se versiona. No mantengas cambios nativos únicamente en archivos que se regeneran.

CI debe ejecutar scripts existentes y pruebas significativas conforme se añadan. Parte de instalación reproducible y typecheck; el build de functions/ actual solo comprueba legado. Añade build de server/, pruebas HTTP de autorización y transacciones sobre SQLite temporal cuando P3 entregue la API, y pruebas de contrato o dominio cuando existan. No añadas un job verde que omite errores o ejecuta cero tests sin avisar. Distingue exportación JS, compilación APK y validación física. Evita secretos de producción para verificaciones que pueden usar una API local con SQLite temporal. No apliques audit fix --force que rebaje o cambie Expo; documenta dependencias problemáticas y soluciones compatibles.

Entrega por incrementos: arranque reproducible; contratos mínimos y fixtures; build con módulo nativo; integración de adaptadores; CI del recorrido compartido. Ejecuta npm ci y los scripts existentes que correspondan. Actualmente npm run check compila también functions/, que es código heredado de Firebase, y npm run export:android verifica el bundle JS. Instalar/compilar functions/ solo verifica ese legado, nunca la API nueva. Cuando P3 entregue server/, acuerda scripts propios de instalación, typecheck y pruebas de API con SQLite temporal, y actualiza CI. No inventes comandos ni anuncies una migración implementada solo por modificar documentos. No repitas suites completas sin cambios relevantes. Inspecciona diff y estado del repo antes de integrar, incluyendo solamente cambios propios o explícitamente acordados.

El cierre incluye archivos modificados, contratos publicados, consumidores que deben adaptarse, comandos/resultados, riesgos concretos y evidencia pendiente. Entrega instrucciones breves para que otra persona reproduzca la build. Un merge/push no despliega la API ni migra la base del VPS. No declares acabado el producto por lograr CI verde; tu entrega termina cuando la base es reproducible y las otras áreas pueden trabajar contra contratos claros y compatibles.
```

## Subagente A — Contratos y fixtures

```text
Implementa únicamente src/domain/ y contracts/ con sus pruebas. Lee TDD y DTO existentes; acuerda cambios con personas 3, 4 y 5 antes de romper consumidores. No estás solo: conserva cambios ajenos. No edites package files, backend o runtime Android.

Entrega contratos mínimos de propuesta/respuesta/acuse, errores e identidades/versiones, ejemplos válidos e inválidos y fixtures temporales deterministas. Verifica idempotencia y distinción aceptación/programación. No conviertas tipos en supuesta validación runtime: explicita dónde validar. Solicita cualquier dependencia al principal. Entrega formato de consumo y pendientes, sin commit/push independiente.
```

## Subagente B — Navegación base

```text
Tu zona es app/_layout.tsx y layouts compartidos explícitamente acordados con el principal. Persona 2 conserva rutas concretas y pantallas; persona 5 bootstrap; no los edites. No estás solo y debes preservar modificaciones ajenas.

Prepara navegación base, contrato de rutas/deep links y composición que permitan sesión/grupo/propuesta sin lógica de autenticación remota en los layouts. Coordina los destinos con personas 2 y 6. No aceptes una propuesta al abrir un enlace ni muestres datos de otra sesión. Entrega interfaces y verificaciones de navegación disponibles; no añadas pantallas simuladas como integración real. Sin commit/push propio.
```

## Subagente C — CI reproducible

```text
Implementa solo .github/workflows/ y documentación de CI bajo docs/ci/ si hace falta. No edites scripts, lockfiles ni código de otros: solicita cambios concretos al principal. No estás solo; conserva trabajo ajeno.

Inspecciona comandos reales y versiones Node. Construye instalación reproducible, typecheck y build backend; incorpora tests existentes sin fingir suites. Separa export JS de APK y pruebas físicas. Usa inyección HTTP y SQLite temporal para autorización cuando la suite de persona 3 esté disponible; incluye usuario ajeno, sesión revocada y conflicto de versiones. No exijas secretos de producción para comprobar contratos. Entrega jobs, requisitos y evidencia de lo ejecutado localmente; sin commit/push separado.
```
