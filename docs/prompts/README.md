# Prompts de implementación para las seis personas

Estos documentos siguen el reparto confirmado en [START_HERE](../START_HERE.md): P1 base y contratos, P2 pantallas, P3 SQLite, VPS y agente, P4 alarmas Android, P5 datos/sincronización y P6 widget/tareas/integración. **En tablas de equipo P1–P6 son personas; en el alcance P0/P1/P2 son prioridades.**

Cada archivo contiene un prompt principal extenso y encargos concretos para subagentes. Copia el bloque principal en el agente de tu entorno, con el repositorio abierto. Los encargos secundarios se delegan desde ese agente para que exista una persona responsable de integrar y verificar el resultado.

| Persona | Prompt | Primera entrega verificable |
|---|---|---|
| P1 · Base y contratos | [01_BASE_CONTRACTS.md](01_BASE_CONTRACTS.md) | Development build; payloads y fixtures acordados con P3. |
| P2 · Pantallas | [02_SCREENS.md](02_SCREENS.md) | Formulario, sesión y decisiones conectables; sustituir datos de ejemplo. |
| P3 · SQLite, VPS y agente | [03_SQLITE_VPS_AGENT.md](03_SQLITE_VPS_AGENT.md) | Crear/responder con autorización y transacciones; contrato de borrador/aclarificación del agente. |
| P4 · Alarmas Android | [04_ANDROID_ALARMS.md](04_ANDROID_ALARMS.md) | Programar, sonar y detener una alarma consentida sin JS vivo. |
| P5 · Datos y sincronización | [05_DATA_SYNC.md](05_DATA_SYNC.md) | SQLite local + API HTTP autenticada, pendientes/versiones y conciliación del runtime. |
| P6 · Widget, tareas e integración | [06_WIDGETS_TASKS_INTEGRATION.md](06_WIDGETS_TASKS_INTEGRATION.md) | Widget Android con deep link, tarea vinculada y prueba entre dos móviles. |

P3 dispone además de un [encargo detallado para el subagente de IA](03A_AGENT_SUBAGENT.md). Es parte de su responsabilidad; no constituye una séptima persona ni sustituye el papel de P6.

## Qué copiar y cómo empezar

1. Abre tu checkout del repositorio y selecciona el prompt de tu persona. No compartáis una misma rama de trabajo entre seis entornos independientes.
2. Copia el bloque principal completo. Añade nombres reales y disponibilidad si los conoces; los IDs de usuarios, proyectos o dispositivos se obtienen del entorno, no se inventan.
3. El agente lee primero archivos y estado Git. El código actual prevalece para saber qué existe; el TDD define el comportamiento objetivo. Una diferencia se resuelve con los responsables del contrato.
4. El agente divide trabajo independiente entre los subagentes indicados. Cada uno recibe archivos concretos, contrato de entrada/salida, pruebas y prohibiciones de escritura fuera de su zona.
5. Integra primero una entrega pequeña. Un subagente terminado no demuestra que todo el flujo esté integrado. El agente principal revisa cambios y ejecuta las verificaciones aplicables.

No lanzar seis agentes sobre el mismo `package.json`, esquema o archivo de navegación. Si no hay subagentes disponibles, ejecutar los encargos secuencialmente conservando las mismas fronteras.

Guía visual compartida: [Nevera Retro](../../nevera-retro.md). P1, P2 y P6 deben incorporarla en su trabajo de base, pantallas y widgets, sin ampliar por ello el alcance funcional.

## Acuerdos comunes que acompañan a los seis prompts

- Stack objetivo acordado: Expo/React Native/TypeScript/Router, API HTTPS y SQLite en VPS, registro local y módulo Android acotado. Revisar versiones en los manifiestos y lockfiles antes de instalar dependencias.
- Backend objetivo: `server/src/operations`, `server/src/persistence`, `server/src/messaging` y `server/src/agents`, con Node 22, Fastify y better-sqlite3. P3 creará estas carpetas; `functions/` y `firebase/` actuales son legado y no prueban la nueva arquitectura. No modificar scripts como si `server/` ya existiera.
- P1 integra configuración Expo, layouts/rutas comunes, dependencias raíz y CI; P2 implementa las pantallas/rutas de sus funcionalidades; P3 integra configuración/exports del backend. Coordinar cambios compartidos antes de editar.
- P5 mantiene cliente fetch/HTTPS, sesión opaca en SecureStore, SQLite local, outbox y listeners de expo-notifications. P2 construye la UI de sesión; P3 autentica/autoriza en API y persiste en SQLite del VPS. No crear sesiones paralelas. GET /v1/sync al abrir/reanudar es la base; push Expo opcional (FCM como transporte Android) no garantiza ejecución background.
- P4 posee el registro operativo de alarmas; P5 conserva proyecciones y cola local; P6 consume snapshots, sin crear otra fuente de verdad.
- Los contratos compartidos se acuerdan entre persona 1, persona 3 y los consumidores afectados. Ningún ejemplo de un prompt demuestra que un método ya exista.
- «Aceptada», «programada localmente» y «confirmada al emisor» son estados distintos. Un mock, un push o una captura de UI no acreditan una alarma real.
- Un agente del producto crea borradores y solicitudes de aclaración. El emisor revisa antes del envío y el destinatario decide la activación.
- Las automatizaciones de recurrencia, reintento y cancelación se implementan como reglas deterministas. No requieren un modelo ejecutándose continuamente.
- Las seis personas escriben pruebas de su área. P1 mantiene CI junto con P6, que coordina integración y demo; P3 aporta el recorrido agéntico y P2 su interfaz.

## Handoff: mensaje que debe producir cada agente

```text
Entrega:
- Responsable y objetivo completado:
- Commit/rama y archivos modificados:
- Contrato que expongo (firma, payload, resultado y errores):
- Ejemplo real o fixture etiquetado que puede consumir el siguiente equipo:
- Comandos ejecutados y resultado:
- Pruebas en dispositivo/emulador, si corresponden:
- Limitaciones y pendientes, sin presentar simulaciones como integración:
- Dependencia concreta que necesito de otra persona:
- Siguiente tarea pequeña propuesta:
```

## Integrar sin pisarse

Cada persona trabaja en una rama breve o worktree aislado. Los subagentes de esa persona reciben zonas separadas dentro de su entrega. No revertir cambios ajenos, forzar pushes ni cambiar contratos silenciosamente. Hacer commits de resultados revisables y publicarlos en la rama correspondiente cuando el encargo lo autorice; la persona 1 integra en `main` con las comprobaciones y autorizaciones del equipo. No desplegar el VPS ni ejecutar migraciones de producción por el mero hecho de ejecutar estos prompts.

El agente se concreta dentro del trabajo de P3: primero contrato de borrador/aclarificación y después integración del recorrido autorizado. Estos prompts no dan por completadas las funcionalidades ni alteran por sí solos las prioridades del producto. Véanse [TEAM_PLAN](../TEAM_PLAN.md), [TDD](../TDD.md), [START_HERE](../START_HERE.md) y [FEATURES](../../FEATURES.md).
