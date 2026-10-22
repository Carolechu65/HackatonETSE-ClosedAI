# Contribuir a alarmaT

Este repositorio contiene el diseño y una estructura inicial. Los comandos disponibles y límites del scaffold están en [START_HERE](docs/START_HERE.md). El stack acordado es Expo, React Native, TypeScript, Expo Router, API propia y SQLite en el VPS. Consulta el [TDD](docs/TDD.md) antes de programar y el [plan de seis personas](docs/TEAM_PLAN.md) para identificar responsables.

## Organización y dependencias

- Las rutas Expo Router delegan en funcionalidades dentro de `src/`. El backend objetivo vive en `server/`; `functions/` es el scaffold legado pendiente de migrar y el módulo local de alarmas, cuando se implemente, en `modules/alarm-runtime/`.
- La UI tramita acciones mediante hooks/controladores y representa estados explícitos. No accede a SQLite del servidor ni salta el repositorio HTTP ni programa alarmas desde los componentes.
- Los repositorios separan datos compartidos, proyecciones SQLite y lógica de presentación. El adaptador Android implementa la programación del sistema detrás de una interfaz.
- Mantener DTO de red, filas SQLite y modelos de dominio separados cuando sus ciclos de vida difieran. El registro nativo de alarmas tiene una única autoridad y se consulta mediante su interfaz; no modificar su almacenamiento desde JS en paralelo.
- Inyectar reloj, zona horaria, repositorios y programador para probar cambios de hora y fallos de forma determinista.
- Mantener el servidor HTTP en TypeScript y contratos compartidos mediante esquemas y ejemplos versionados. Android y backend deben aceptar los mismos estados, versiones y códigos de error.

Las rutas concretas y sus propietarios están en TEAM_PLAN; no crear una estructura alternativa en paralelo.

## Convenciones

- Nombres de código en inglés y textos de interfaz centralizados; documentación de equipo en español.
- React: hooks con limpieza de listeners y efectos; no temporizadores de pantalla como motor de alarmas, ni llamadas de negocio durante renderizado.
- Kotlin, dentro del módulo nativo: contratos explícitos, cancelación propagada y ninguna dependencia de red o JS para detener una alarma.
- TypeScript: modo estricto, validación de entradas en ejecución y errores tipados. Los tipos del compilador no validan lo enviado por un cliente.
- Fechas: instantes UTC junto con zona IANA y hora local cuando la recurrencia lo requiera. Importes: enteros en la unidad mínima de la moneda.
- Estado remoto, consentimiento y programación local son conceptos distintos. No utilizar un único booleano `active` para todos ellos.
- Reintentos con identificadores estables y versiones. Una excepción no equivale a éxito; mostrar o conservar el estado pendiente.
- Limitar registros a identificadores de operación y resultados; no registrar tokens, credenciales ni contenido privado completo.
- Fijar dependencias y herramientas con lockfile y versiones compatibles con Expo. P5 mantiene un cliente HTTP y sesión única en SecureStore. No añadir RNFirebase ni duplicar clientes o colas de mutaciones.

## Trabajo en paralelo

1. Convertir una entrega del plan en una tarea con propietario, rutas, contrato de entrada/salida y evidencia de aceptación.
2. Crear una rama breve por tarea, por ejemplo `feat/alarm-consent` o `fix/schedule-recovery`.
3. Avisar al propietario antes de modificar su área. Los cambios de contratos se acuerdan con ambos consumidores y se entregan con un ejemplo actualizado.
4. Abrir PR pequeñas que dejen una unidad revisable. Integrar a diario; evitar seis ramas aisladas hasta el último día.
5. Solicitar revisión a alguien que consuma el cambio. Los contratos y reglas requieren revisión cruzada Android/backend.
6. Resolver conflictos preservando las modificaciones de los compañeros. No reescribir la historia compartida de `main`.

## Uso de asistentes de código

Asignar tareas acotadas indicando archivos permitidos, contratos, restricciones y prueba observable. El autor humano revisa el diff y ejecuta las comprobaciones antes de integrar. No aceptar APIs inventadas ni sustituir una integración real por un mock sin indicarlo. Los asistentes no reciben credenciales de servidor ni datos privados del grupo.

Un prompt útil: «Implementa el repositorio dentro de estas rutas, contra este contrato y estos casos de error; conserva los cambios ajenos; añade pruebas del reintento y de la versión obsoleta; informa de qué verificaste y qué falta».

## Pruebas y revisión

La estrategia detallada y los escenarios están en el [TDD](docs/TDD.md). Priorizar invariantes: consentimiento, versiones, idempotencia, permisos por destinatario, tiempo y recuperación de alarmas. No escribir pruebas que solo repitan la implementación.

Para cada PR de código:

- Compilar y ejecutar formato, análisis estático y pruebas del área afectada.
- Probar endpoints, autorización y migraciones con SQLite temporal real cuando cambien datos, permisos o contratos.
- Aportar evidencia en dispositivo cuando cambie sonido, notificaciones, widgets o ciclo de vida. Un test unitario no demuestra que una alarma suene.
- Actualizar documentación y ejemplos de contratos si cambia el comportamiento.
- Explicar limitaciones conocidas y distinguir resultados reales de simulaciones.

La CI actual comprueba TypeScript, contratos, tests y export Android, y aún compila `functions/`. P1/P3 deben sustituir ese paso por build/tests del servidor HTTP y migraciones SQLite al implementarlo. Un check del legado no acredita la migración. Los cambios nativos requieren reconstruir la app; una recarga JS no basta. No presentar comprobaciones pendientes como ejecutadas.

## Definición de terminado

Una entrega está terminada cuando cumple su criterio observable, tiene revisión, supera las comprobaciones aplicables, está integrada y conserva un recorrido funcional de la demo. Aceptar un aviso en la pantalla no basta para terminar la programación: debe existir evidencia del registro local, la llamada al sistema y el estado comunicado al emisor.

El push de documentación no despliega el VPS. Contraseñas de infraestructura, secretos de IA y credenciales push permanecen en el entorno de servidor. Cada endpoint valida sesión, pertenencia, recurso y transición; ocultar un botón o conocer un ID no autoriza acceso.
