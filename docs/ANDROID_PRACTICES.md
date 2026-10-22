# Expo y Android: prácticas para alarmaT

**Verificación: 22 de octubre de 2026. Estado: diseño pendiente de implementar.** Las fuentes oficiales sustentan capacidades y restricciones; las decisiones de arquitectura son propuestas para este hackathon. No se han medido todavía rendimiento ni fiabilidad del prototipo.

## 1. Stack elegido y motivo

**Expo + React Native + TypeScript + Expo Router + API HTTPS + SQLite en VPS**, con `expo-widgets`, `expo-sqlite` y `expo-notifications`. Se prioriza rapidez para un equipo React/TypeScript. El módulo local `modules/alarm-runtime` concentra Kotlin y APIs Android necesarias para la alarma sonora, sin reescribir las pantallas en Compose.

La API objetivo usa Node 22, Fastify y better-sqlite3; P3 implementará autenticación, autorización y persistencia. P5 consume HTTPS con fetch y guarda el token bearer opaco en expo-secure-store. La app no accede al archivo del VPS. No se añaden SDK de Firebase ni RNFirebase. Se requiere una development build para el módulo nativo y los widgets. Fijar versiones compatibles y reconstruir tras cambios nativos. [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/), [development builds](https://docs.expo.dev/develop/development-builds/introduction/).

`expo-notifications` permite programar recordatorios locales. Una alarma de despertador con sonido sostenido, detener y posponer requiere demostrar el comportamiento del runtime nativo. No basta una notificación con sonido breve. [Expo Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/), [módulos locales Expo](https://docs.expo.dev/modules/get-started/).

## 2. Organización y propiedad

La estructura normativa y los contratos están en el [TDD](TDD.md); los seis propietarios y horas, en [TEAM_PLAN](TEAM_PLAN.md).

```text
app/                         # rutas y layouts Expo Router
src/features/                # auth, groups, alarms, tasks; gastos en P1
src/domain/                  # modelos, reglas, tiempo y contratos
src/data/                    # SQLite local, HTTPS/SecureStore y repositorios
src/platform/alarms/         # interfaz TypeScript hacia runtime
src/platform/notifications/  # recordatorios estándar
src/platform/sync/           # conciliación y reintentos
src/widgets/                 # vistas y snapshots expo-widgets
src/bootstrap/               # sesión, ciclo de app y eventos push opcionales
modules/alarm-runtime/       # Kotlin, registro durable y componentes Android
server/                      # objetivo: API Node/Fastify + SQLite del VPS
functions/                   # código heredado pendiente de migración
contracts/                   # esquemas y fixtures comunes
```

La estructura mezcla bases existentes y rutas objetivo; `server/` debe implementarlo P3. Compilar `functions/` solo comprueba el backend heredado, no valida la API nueva. Mantener pantallas pequeñas, efectos con limpieza de listeners y dominio independiente de React. Los componentes no llaman directamente a la API ni mantienen temporizadores para hacer sonar alarmas. Inyectar reloj, repositorio y runtime facilita probar estados y fallos.

Los permisos, servicios y receptores se configuran mediante plugins/configuración reproducible. Un cambio nativo obliga a reconstruir el binario; Fast Refresh no lo instala. No depender de modificaciones manuales en archivos generados que se perderían al regenerarlos. [Generación nativa continua](https://docs.expo.dev/workflow/continuous-native-generation/).

## 3. Tres registros con funciones distintas

| Registro | Autoridad |
|---|---|
| SQLite del VPS, detrás de API HTTPS | Propuesta vigente, pertenencia y consentimiento confirmado; autorización de cada operación y lectura en servidor. |
| expo-sqlite | Proyecciones de la app, formularios y comandos pendientes. |
| Registro privado de alarm-runtime | Ocurrencias sonoras, versiones, cancelaciones y ejecución local sin JS. |

Una base abierta mediante `expo-sqlite` no garantiza acceso desde un receptor Kotlin. El módulo mantiene su propio registro operativo y expone snapshots y resultados a TypeScript. SQLite no sobrescribe una cancelación nativa con datos antiguos. El runtime no necesita conexión al VPS ni React para detener una alarma. [SQLite de Expo](https://docs.expo.dev/versions/latest/sdk/sqlite/).

Secuencia: confirmar consentimiento en servidor → persistir comando nativo → programar Android → registrar resultado → actualizar proyección SQLite → enviar acuse. No existe transacción atómica entre esas piezas: identificadores estables y reconciliación recuperan fallos intermedios.

Una aceptación nueva sin red queda pendiente; una alarma ya programada puede ejecutarse offline. Desactivar localmente se aplica de inmediato y se sincroniza después. Una cancelación remota puede llegar tarde a un teléfono desconectado y se muestra pendiente hasta su acuse.

Para recordatorios estándar, el adaptador conserva el ID que devuelve expo-notifications. Para alarmas sonoras, el propietario es alarm-runtime. No programar la misma ocurrencia por ambos caminos. La UI distingue modalidades y capacidades.

## 4. Sincronización, push y widgets no sustituyen al runtime

P5 sincroniza mediante GET /v1/sync con cursor por usuario/alcance al abrir, reanudar y recuperar red. Mientras la app esté activa puede usar polling acotado; SSE es opcional y no garantiza recepción con la app cerrada. P3 filtra todas las lecturas. El móvil persiste cada página antes de avanzar cursor y descarta respuestas de sesiones anteriores.

Expo Push Service con expo-notifications es una mejora opcional para avisar de novedades. P5 gestiona tokens/listeners y P3 envía desde servidor; no instalar RNFirebase ni Firebase Admin. En Android el transporte sigue siendo FCM y requiere credenciales Google configuradas; cambiar la base a SQLite no elimina esa dependencia del push. Sin ellas, validar propuesta y respuesta con las dos apps abiertas, y probar por separado la alarma ya programada con el proceso cerrado. Un push invita a sincronizar, nunca concede consentimiento ni garantiza ejecutar JS en segundo plano. Comprobar presentación única y limpieza al cerrar sesión. [Configuración de push Expo](https://docs.expo.dev/push-notifications/push-notifications-setup/).

## 5. Permisos y ejecución Android

### Programación y presentación son responsabilidades distintas

Para una alarma audible de reloj se propone evaluar `setAlarmClock()` en el primer experimento; para recordatorios menos estrictos, usar la modalidad correspondiente. `AlarmManager` dispara un evento aunque la interfaz no esté en ejecución, pero no crea automáticamente sonido, botones ni pantalla. El acceso a alarmas exactas se comprueba antes de registrar cada ocurrencia. [AlarmManager](https://developer.android.com/develop/background-work/services/alarms).

| Requisito | Comportamiento de alarmaT |
|---|---|
| `POST_NOTIFICATIONS` en Android 13+ | Pedir permiso en contexto; comprobar también canal y ajustes. Si el producto no puede presentar correctamente el aviso, mostrar bloqueo de activación. |
| Acceso a alarmas exactas | Para el primer prototipo, elegir `SCHEDULE_EXACT_ALARM` y comprobar `canScheduleExactAlarms()`. No declarar simultáneamente permisos alternativos por copiar una plantilla. |
| `USE_EXACT_ALARM` | Evaluarlo solo si la distribución y funcionalidad de reloj cumplen sus condiciones; no tomar la concesión automática como autorización universal. |
| Revocación de permisos | Reconciliar al volver a la app; no seguir mostrando una programación como vigente sin comprobación. |
| Full-screen intent | Comprobar `canUseFullScreenIntent()` donde corresponda. La app no promete abrir una pantalla a la fuerza. |
| Sonido sostenido | Implementar un servicio visible únicamente durante la alarma, con tipo y permisos adecuados, notificación y acciones parar/posponer. |

El permiso de notificaciones es distinto del acceso a alarmas exactas. Para alarmaT se decide exigir una presentación visible funcional antes de marcar activación; esta es una regla del producto, no una afirmación de que Android impida cualquier servicio sin `POST_NOTIFICATIONS`. [Permiso de notificaciones](https://developer.android.com/develop/ui/compose/notifications/notification-permission).

Android restringe inicios de servicios desde segundo plano; una alarma exacta solicitada por el usuario es una de las excepciones documentadas. En API 34+ hay que declarar un tipo de servicio válido. Se propone validar `systemExempted` para el servicio de alarma bajo sus requisitos de permisos exactos; si deja de cumplirlos no se fuerza el inicio. No utilizar `dataSync` como etiqueta genérica para reproducir alarmas. [Inicio de foreground services](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start), [tipos de servicios](https://developer.android.com/develop/background-work/services/fgs/service-types).

Full-screen intent está sujeto a elegibilidad y permiso. Si no está disponible, la notificación puede ofrecer acceso al aviso; el estado y la demo deben describir ese modo real. No pedir permisos de superposición ni accesibilidad para sortear restricciones. [Límites de full-screen intent](https://source.android.com/docs/core/permissions/fsi-limits).

### Recuperación, tiempo y límites reales

- **Reinicio:** reconstruir ocurrencias futuras aceptadas a partir del registro nativo de alarmas tras el arranque y acceso al almacenamiento. El MVP requiere primer desbloqueo; alarmas antes de desbloquear necesitan diseño Direct Boot adicional y quedan fuera. [Direct Boot](https://developer.android.com/privacy-and-security/direct-boot).
- **Proceso cerrado:** probar que una alarma ya registrada funciona sin Activity ni ViewModel vivos.
- **Forzar detención:** tratarlo como caso diferente. Android 15 cancela los `PendingIntent` al entrar en estado detenido; la recuperación exige interacción del usuario. No prometer resistencia a force-stop. [Cambio Android 15](https://developer.android.com/about/versions/15/behavior-changes-all).
- **Hora y zona:** guardar instante UTC y zona IANA. Para una alarma puntual, la política propuesta mantiene el instante al viajar y muestra la hora local equivalente. Para recurrencia, mantener hora civil y zona acordadas; definir qué ocurre con horas inexistentes o duplicadas por cambio horario.
- **Repetición:** calcular la siguiente ocurrencia autorizada; no usar una alarma repetitiva inexacta como sustituto de una serie exacta.
- **Retraso:** una propuesta ya vencida no empieza a sonar al reconectar. Una ocurrencia perdida se marca como tal; no activar todas las anteriores de una serie.
- **DND, volumen y fabricante:** registrar las condiciones de prueba; no garantizar sonido si el usuario o sistema lo impiden. Nunca modificar esos ajustes sin una elección explícita.

## 6. Widgets Android con expo-widgets

La documentación actual incluye soporte Android opt-in mediante `enableAndroid`, `android.package` y componentes compatibles de `@expo/ui/jetpack-compose`. Tras configurar el plugin hay que reconstruir. La actualización desde la app usa `updateSnapshot`; no asumir que las funciones documentadas solo para iOS estén disponibles en Android. [Expo Widgets](https://docs.expo.dev/versions/latest/sdk/widgets/).

El widget recibe props pequeñas y se ejecuta en un entorno separado. No consulta la API ni espera promesas durante el render. Tampoco se da por hecho que un callback visual persista una aceptación o programe Android. Para el MVP, los botones que necesiten ejecutar el contrato completo abren la propuesta mediante un enlace a la app. El widget muestra última sincronización y datos pendientes.

Una acción directa con la app cerrada solo se habilita después de comprobar persistencia, permisos, programación y acuse. No basarse en un listener que únicamente funciona mientras vive el proceso de la app.

La documentación de Android 17/API 37 describe restricciones de memoria para bitmaps/iconos de RemoteViews y para procesos. Usar texto e iconos pequeños, evitar cachés sin límite y probar esa API cuando esté disponible en el entorno del equipo; una página de cambios no prueba por sí sola el estado estable de cada biblioteca. [Cambios al apuntar a Android 17](https://developer.android.com/about/versions/17/behavior-changes-17), [cambios generales](https://developer.android.com/about/versions/17/behavior-changes-all).

## 7. Prueba de viabilidad y verificación

**Primer día:** dos móviles con development build → A propone → B acepta → B programa → cerrar proceso y bloquear pantalla → sonar → detener/posponer. Repetir rechazando y cambiando hora. Validar además widget y compatibilidad de los servicios de mensajería.

Si la alarma sonora no funciona, sigue bloqueada: se reduce primero IA, finanzas y decoración, y se concentra el trabajo en el runtime. No presentar una notificación estándar como prueba de alarma despertador.

| Nivel | Evidencia necesaria |
|---|---|
| TypeScript puro | Consentimiento por versión, reintentos, caducidad y fixtures de cambios horarios. |
| Runtime Kotlin | Identidad estable, cancelación, sustitución, recuperación y snapshot tras fallos intermedios. |
| API con SQLite temporal | Autorización, idempotencia, conflictos y rechazo de acuses antiguos. |
| UI/widget | Estados pendientes, otra hora, rechazo, permisos y deep links. |
| Dispositivos físicos | Pantalla bloqueada, cierre de proceso, Doze, reinicio tras desbloqueo, offline, revocación y force-stop. |

Probar versiones que cubran los cambios de permisos y las de los móviles disponibles; registrar fabricante, API, permisos, hora prevista/real y resultado. Los mocks de AlarmManager no demuestran que suene el teléfono. [Fundamentos de pruebas Android](https://developer.android.com/training/testing/fundamentals).

CI prevista: TypeScript, lint, pruebas de dominio/contratos, API HTTP con una SQLite temporal y aislamiento de usuarios y build Android; pruebas del módulo nativo cuando exista. Medir tamaño instalado, arranque, RAM, batería y desviación de horario en build de distribución. No se afirma que Expo sea más ligero que Kotlin sin mediciones.
