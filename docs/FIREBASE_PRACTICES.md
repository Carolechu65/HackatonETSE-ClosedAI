# Firebase para alarmaT: decisiones y prácticas verificadas

**Fecha de consulta: 22 de octubre de 2026. Estado: diseño pendiente de implementar.** Esta selección aplica documentación oficial al tamaño del hackathon; no pretende demostrar un «SOTA absoluto» ni un rendimiento medido. El contrato definitivo del producto se concreta en el TDD y las prioridades en `FEATURES.md`.

## 1. Stack y límites de responsabilidad

| Pieza | Responsabilidad en alarmaT | Decisión de implementación |
|---|---|---|
| Firebase Authentication | Identidad del usuario | Correo/contraseña para el primer recorrido; Google opcional. `uid` es la identidad, nunca un correo enviado por el cliente. |
| Cloud Firestore | Estado compartido de grupos y propuestas | Documentos pequeños, consultas acotadas y reglas por pertenencia y destinatario. |
| Cloud Functions, segunda generación, TypeScript | Comandos que cambian estados compartidos | Validación de entrada, autorización, transacciones, idempotencia y envío FCM desde servidor. |
| Firebase Cloud Messaging | Avisar de una nueva propuesta o cambio | Entrega orientativa; no es el reloj que hace sonar la alarma. |
| Expo + React Native + TypeScript + Expo Router | Aplicación y navegación | Desarrollo compartido en TypeScript con development build Android. |
| `expo-sqlite` | Proyección local y cola de comandos | Datos de UI/widgets, intenciones pendientes y ACK pendientes; sin depender de un componente React montado. |
| `modules/alarm-runtime` | Programación y registro durable nativos | Adaptador Expo Modules API sobre Android; solo programa tras consentimiento y permisos. Su registro es la autoridad sobre las ocurrencias programadas. |

**Elección concreta del cliente Firebase:** `@react-native-firebase/app`, `auth`, `firestore`, `functions` y `messaging`, con API modular y versiones compatibles fijadas en el lockfile. No instalar en paralelo el paquete `firebase` JS SDK para esos mismos servicios ni mantener dos sesiones/cachés Firebase. El JS SDK permite comenzar rápido con Auth y Firestore en Expo, pero elegimos React Native Firebase por su acceso al SDK nativo y al manejo de FCM en segundo plano. Como ya necesitamos widgets y el módulo de alarmas, la compilación nativa forma parte del proyecto. [Guía oficial de Expo sobre Firebase](https://docs.expo.dev/guides/using-firebase/).

Registrar una app Android en Firebase cuyo package coincida con `app.config.ts`, configurar `android.googleServicesFile` y los config plugins que requiera cada paquete. React Native Firebase funciona con development builds y no con Expo Go. Al añadir una dependencia o configuración nativa hay que reconstruir el binario; Fast Refresh no incorpora código nativo nuevo. No editar dependencias Gradle generadas para imponer otro BoM sin necesidad comprobada. [Instalación Expo de React Native Firebase](https://rnfirebase.io/) y [development builds de Expo](https://docs.expo.dev/develop/development-builds/introduction/).

`expo-sqlite` conserva la base local entre reinicios de la app. Guardar allí proyecciones y comandos pendientes; no asumir que el receptor Kotlin puede abrir esa base mediante las API JavaScript. El módulo nativo mantiene su propio registro de ocurrencias y expone reconciliación hacia TypeScript. [Persistencia SQLite de Expo](https://docs.expo.dev/versions/latest/sdk/sqlite/). La frontera y el spike del modo de alarma audible se detallan en el TDD; el éxito de una notificación simple no valida ese modo.

Mantener TypeScript en modo `strict`, dependencias fijadas con lockfile y un runtime de Node admitido por Functions en el momento de inicializar el proyecto. No incorporar Storage, Analytics, extensiones o una segunda base de datos mientras no haya una necesidad del MVP.

## 2. Modelo de datos propuesto

Las rutas siguientes son la referencia propuesta para coordinar Android y backend. Todas las mutaciones de dominio pasan por funciones callable; Firestore se lee directamente con Rules. Las colecciones internas no se exponen al cliente.

| Ruta | Datos principales | Quién puede consultar / quién muta |
|---|---|---|
| `users/{uid}` | Nombre visible, preferencias, `primaryDeviceId` y `deviceEpoch` | Usuario propio; perfil público de grupo separado. |
| `users/{uid}/devices/{deviceId}` | Token FCM, plataforma y última actualización | Usuario propio / callable autenticada. Nunca visible a otros miembros. |
| `groups/{groupId}` | Nombre, creador, fechas | Miembros / callable. |
| `groups/{groupId}/members/{uid}` | Rol, nombre visible, estado de pertenencia | Miembros / callable con autorización. |
| `groups/{groupId}/alarmRequests/{requestId}` | Emisor, título, hora propuesta, zona IANA, modo, `requestVersion`, estado, tarea opcional | Emisor y destinatarios activos del grupo / callable. |
| `groups/{groupId}/alarmRequests/{requestId}/recipients/{uid}` | Decisión, versión aceptada, `decisionRevision`, hora elegida y ACK de recepción | Emisor y ese destinatario / callable que verifica el actor. |
| `groups/{groupId}/alarmRequests/{requestId}/recipients/{uid}/schedules/{occurrenceId}` | ACK de programación por ocurrencia, dispositivo, `deviceEpoch`, versiones y estado | Emisor y ese destinatario / callable que verifica actor y dispositivo. |
| `groups/{groupId}/tasks/{taskId}` | Responsable, asignación, vencimiento, estado | Miembros / callable. |
| `operations/{operationKey}` | Actor, tipo, hash de entrada, resultado, fecha | Servidor. Deduplicación de comandos. |
| `outbox/{eventId}` | Tipo de aviso, destinatario, versión, intentos, estado | Servidor. Trabajo de notificación pendiente. |

La bandeja consulta propuestas del grupo mediante `recipientUids array-contains auth.uid`; los envíos propios filtran `creatorUid == auth.uid`. `recipientUids` es una lista acotada de destinatarios de la propuesta, consistente con sus documentos individuales. Acordar índices en `firestore.indexes.json` y probar las consultas con las Rules. Las reglas no deben permitir a cualquier miembro leer todas las alarmas privadas del grupo. El [TDD](TDD.md) es la referencia normativa de campos y rutas.

Evitar una matriz creciente de eventos, tokens o respuestas dentro de un único documento. Guardar fechas absolutas como timestamps, la zona como identificador IANA y el horario local de una recurrencia por separado. Para una alarma puntual conservar el instante acordado; no reinterpretarlo silenciosamente al viajar. `createdAt` y `updatedAt` los establece el servidor. Importes futuros: enteros en céntimos y moneda explícita.

La salida del grupo revoca nuevas lecturas y cambios compartidos. El dispositivo reconcilia sus alarmas cuando recibe la revocación; una copia offline o una alarma ya programada no desaparecen mágicamente. La interfaz debe mostrar la cancelación remota pendiente hasta recibir confirmación del dispositivo.

## 3. Autorización: Rules y Functions tienen trabajos distintos

Las callable incluyen y validan tokens de autenticación cuando están disponibles. Cada handler debe rechazar explícitamente una petición sin `request.auth`; un token válido tampoco prueba que el usuario pertenezca a ese grupo o pueda aceptar por otra persona. [Funciones callable](https://firebase.google.com/docs/functions/callable).

El Admin SDK y las bibliotecas de servidor no pasan por Firestore Security Rules. Por ello, la función debe validar identidad, pertenencia, rol, destinatario, transición permitida, versión y caducidad **antes** de escribir. Probar Rules no prueba automáticamente esa autorización del servidor. [Bibliotecas cliente y servidor](https://firebase.google.com/docs/firestore/client/libraries).

Contrato de seguridad del MVP:

- Denegar por defecto; nunca publicar reglas generales `allow read, write: if true`.
- Permitir lecturas solo al ámbito definido en la tabla. Denegar escrituras cliente en documentos de dominio, operaciones y outbox: se realizan mediante callable.
- Una función obtiene `actorUid` de `request.auth.uid`; ignora cualquier `actorUid` suministrado como autoridad en el cuerpo.
- Crear una propuesta requiere que emisor y destinatarios pertenezcan al grupo y que estos acepten recibir propuestas de ese ámbito.
- Solo el destinatario decide aceptar, rechazar o elegir otra hora. El emisor puede retirar una propuesta, pero no autorizarla en su nombre.
- Un ACK comprueba usuario, dispositivo principal registrado y versión. Es una declaración del cliente; no demuestra físicamente que el altavoz haya sonado.
- App Check puede reforzar el origen de las peticiones; complementa a Auth y a la autorización, no los sustituye. Usar proveedor de depuración solo en entornos de desarrollo y registrar su configuración fuera de Git. [App Check](https://firebase.google.com/docs/app-check).

Los roles de IAM del despliegue y de las funciones se limitan a sus necesidades. No poner una credencial Admin SDK ni una clave privada de cuenta de servicio en el APK, en el repositorio o en un prompt.

## 4. Consistencia: consentimiento no equivale a programación

Separar tres ejes en el contrato:

| Eje | Ejemplos | Autoridad |
|---|---|---|
| Propuesta | Activa, retirada, caducada | Backend |
| Respuesta del destinatario | Pendiente, aceptada, rechazada; hora elegida | Destinatario, validado por backend |
| Programación del dispositivo | Pendiente, programada, bloqueada por permiso, cancelada | Dispositivo, ACK validado por backend |

Recorrido normal:

1. El emisor manda un comando con `operationId`; el servidor valida y guarda propuesta y destinatarios.
2. El destinatario recibe un aviso y obtiene el documento autorizado. FCM no sirve como fuente de verdad.
3. Acepta una **versión concreta** y una hora. El backend confirma la transición y devuelve la versión vigente.
4. El cliente conserva la confirmación en `expo-sqlite` y llama al adaptador nativo, que comprueba permisos, persiste su registro y programa localmente. Si falla, mantiene «pendiente de activación» con causa.
5. Android envía el ACK con versión y dispositivo. Solo entonces el emisor ve «programada». Si falta red tras programar, el receptor puede verla programada localmente y el emisor seguirá esperando la confirmación.

**Decisión para acotar el MVP:** aceptar por primera vez o cambiar una propuesta compartida requiere confirmación del servidor. Sin conexión, guardar la intención en `expo-sqlite` y mostrar «pendiente de sincronización», sin programar una nueva alarma compartida a partir de una versión potencialmente cancelada. Una alarma ya aceptada y programada sí puede sonar sin red. Apagarla o posponerla localmente sigue funcionando mediante el adaptador; sincronizar después el cambio. En cierre de sesión, cancelar las alarmas de esa sesión y limpiar los datos operativos accesibles al siguiente usuario.

Firestore permite persistencia y acceso a caché offline, pero la convergencia de escrituras concurrentes al mismo documento no implementa por sí sola las reglas del producto. Firestore conserva el estado compartido; `expo-sqlite`, su proyección y la cola del cliente; el módulo nativo, el estado operativo de alarmas. Evitar dos colas independientes para el mismo comando. [Acceso offline](https://firebase.google.com/docs/firestore/manage-data/enable-offline). Un snapshot local no equivale a confirmación del servidor: usar los metadatos apropiados cuando se represente ese estado. [Listeners y metadatos](https://firebase.google.com/docs/firestore/query-data/listen).

Las escrituras en Firestore, SQLite JS y el registro nativo no forman una transacción única. Persistir claves estables y permitir consultar las ocurrencias del módulo para reconstruir proyecciones/ACK después de un cierre entre programación y confirmación. Solo el ACK de una programación nativa verificada permite representar «programada» en el servidor.

## 5. Comandos repetidos, cambios concurrentes y eventos fuera de orden

Cada comando incluye `operationId` UUID estable durante sus reintentos y `expectedRequestVersion` cuando modifica una propuesta existente; las mutaciones de respuesta también incluyen `expectedDecisionRevision`. El servidor deriva una clave de operación del usuario y ese identificador; guarda hash de entrada y resultado en la misma transacción que el cambio. Repetir la misma entrada devuelve el mismo resultado. Reutilizar el ID con otra entrada se rechaza. Una versión incompatible devuelve conflicto y exige refrescar.

`requestVersion` cambia cuando el emisor cambia sus términos o retira la propuesta. Cada destinatario conserva `decisionRevision` para su decisión y horario; la respuesta de B no invalida la de C. Las mutaciones del destinatario comprueban ambas revisiones y `reportSchedule` identifica el par al que corresponde, junto al `deviceEpoch` vigente del dispositivo principal. Un cambio de términos exige consentimiento para la nueva versión y deja explícita la cancelación pendiente de cualquier programación anterior.

Una transacción puede reintentarse. No enviar FCM, tocar la UI ni ejecutar efectos externos dentro de su callback; crear un registro de outbox dentro de la transacción y procesarlo después. Las transacciones de cliente fallan sin conexión. [Transacciones Firestore](https://firebase.google.com/docs/firestore/manage-data/transactions).

Los triggers de Firestore pueden llegar varias veces y fuera de orden. El procesador debe revisar estado y versión actuales, reclamar trabajo de forma transaccional y registrar el resultado. Un fallo entre el envío FCM y el registro de éxito aún puede duplicar un aviso; no prometer entrega exactamente una vez. Deduplicar en Android mediante `eventId` y usar un identificador de notificación estable. [Semántica de triggers](https://firebase.google.com/docs/functions/firestore-events).

Ejemplo obligatorio: llega «aceptada v2», después una cancelación v3 y por último un ACK atrasado v2. El backend conserva v3; el ACK atrasado no resucita la alarma. Android ignora instrucciones inferiores a su versión conocida y cancela la programación al reconciliar v3. Si estaba sin red, puede sonar antes de conocer la cancelación; ese límite se muestra al emisor.

## 6. FCM y funcionamiento en segundo plano

Usar FCM para anunciar propuestas y cambios; el disparo depende del adaptador Android y del estado local. La prioridad alta solicita entrega rápida para contenido urgente y visible, pero no garantiza un plazo. El procesamiento disponible es limitado; no mantener un listener abierto esperando trabajo indefinido. La prioridad FCM y la importancia del canal Android son configuraciones diferentes. [Prioridad de mensajes Android](https://firebase.google.com/docs/cloud-messaging/android-message-priority).

React Native Firebase será el único propietario de los tokens y de la recepción remota FCM. Registrar `setBackgroundMessageHandler` fuera de componentes, antes de cargar la entrada de Expo Router; devuelve una promesa, no modifica estado React y realiza trabajo acotado. `onMessage` atiende el primer plano. Android puede ejecutar el handler mediante Headless JS, sujeto al sistema; el forzado de detención requiere reabrir la app. Para invitaciones visibles, usar `notification + data`: si el sistema ya presenta el aviso en segundo plano, no duplicarlo desde el handler. [Handlers y estados de React Native Firebase Messaging](https://rnfirebase.io/messaging/usage).

No añadir Expo Push Service ni una segunda ruta de registro push al MVP. Si se usa `expo-notifications`, limitar su responsabilidad a la presentación/local scheduling que admita el adaptador, sin registrarlo como otro receptor remoto ni convertir una notificación de sonido breve en alarma persistente. La notificación local y el módulo de alarma comparten el contrato de consentimiento.

Los widgets reciben snapshots preparados. Su render no consulta Firestore ni espera promesas: el runtime de `expo-widgets` es independiente. Actualizar el snapshot al reconciliar en la app y, solo cuando el handler pueda ejecutarse, tras una sincronización de fondo validada. El widget puede mostrar datos anteriores; un toque abre la propuesta para confirmar estado actual. No prometer actualización inmediata mientras la app permanece cerrada. [Runtime y actualización de Expo Widgets](https://docs.expo.dev/versions/latest/sdk/widgets/).

Payload mínimo: identificadores, versión, tipo de evento y texto neutro para presentar la invitación. No enviar tokens, saldo del grupo ni contenido sensible innecesario. Un toque abre la propuesta y consulta el estado autorizado vigente. Guardar y renovar tokens por instalación; retirar tokens que FCM declare inválidos. No utilizar topics como mecanismo de autorización de propuestas privadas.

Sincronizar al abrir la app y al recuperar conectividad aunque no haya llegado FCM. Una propuesta caducada no se programa automáticamente al recibirse tarde. Los permisos Android, la programación exacta, el reinicio y la interfaz de alarma se especifican en el TDD; un push exitoso no prueba ninguno de ellos.

## 7. Pruebas y CI necesarias

Usar Emulator Suite para Auth, Firestore y Functions en desarrollo y CI. Preparar datos sintéticos con usuarios A, B y C; dos grupos; una propuesta solo de A a B. Las pruebas de Rules usan `@firebase/rules-unit-testing`, contextos autenticados y no autenticados, y aserciones de permitido/denegado. [Pruebas de Rules](https://firebase.google.com/docs/firestore/security/test-rules-emulator).

| Prueba | Resultado requerido |
|---|---|
| C intenta consultar la propuesta A → B aunque comparta piso | Denegado. |
| A intenta aceptar por B mediante callable | Denegado. |
| Usuario no autenticado o expulsado intenta mutar el grupo | Denegado. |
| Cliente intenta escribir `accepted` o `scheduled` directamente | Denegado por Rules. |
| Dos invocaciones con mismo `operationId` | Un único cambio lógico y mismo resultado. |
| ID repetido con cuerpo diferente | Error de conflicto. |
| Cambiar hora y cancelar a la vez | Una versión gana; la otra operación recibe conflicto. |
| Trigger repetido, ACK atrasado o FCM v2 después de v3 | No duplica programación ni revive una cancelación. |
| Se programa localmente y falla el ACK de red | Estado local conservado; ACK reintentable, emisor pendiente. |
| Aceptar una propuesta offline, retirada o caducada | No se programa una nueva alarma compartida. |

Pipeline previsto: instalación reproducible, formato/lint, compilación TypeScript, pruebas puras, Rules y pruebas de integración con emuladores; la app Expo y el módulo Android ejecutan sus comprobaciones aparte. Configurar `firebase emulators:exec` con proyecto de demostración `demo-alarmat` y solo los emuladores necesarios. Esos emuladores no requieren login para este uso; no entregar credenciales de producción a las pruebas de PR. [Configuración e integración de Emulator Suite](https://firebase.google.com/docs/emulator-suite/install_and_configure).

FCM real y los permisos/programación Android se validan en dos móviles físicos de demo. Un test verde del emulador Firebase no demuestra entrega push ni que una alarma suene con la app cerrada. No declarar comandos de CI como operativos hasta crear los scripts que invocan.

## 8. Configuración, coste y despliegue

- Configuración no secreta con parámetros tipados; secretos externos mediante Secret Manager y acceso solo desde las funciones que los requieren. No comenzar con `functions.config()`, que está obsoleto. Para emuladores, secretos ficticios en `.secret.local` ignorado por Git. [Configuración de Functions](https://firebase.google.com/docs/functions/config-env).
- Separar entorno local de proyecto Firebase de demo; seleccionar proyecto explícitamente al desplegar. Versionar Rules, índices, configuración de emuladores y lockfiles. Documentar cómo obtener la configuración Android del proyecto correcto.
- Para desplegar Functions se necesita un proyecto en plan Blaze. Emular localmente no exige desplegarlo. Confirmar la disponibilidad del proyecto facturable al principio del hackathon; no dejarlo para la demo. [Inicio y despliegue de Functions](https://firebase.google.com/docs/functions/get-started).
- Definir límites de instancias, tamaño de grupos, destinatarios, frecuencia de propuestas y lecturas paginadas. Evitar listeners de colecciones completas o bucles de triggers. Las cifras concretas se fijan para el proyecto de demo; no se prometen costes cero.
- Configurar presupuesto y supervisión. A la fecha de consulta, las alertas de presupuesto no detienen servicios, mientras que Firebase documenta presupuestos con límite de gasto para servicios determinados, incluido Functions. Comprobar qué servicios cubre el límite configurado; no asumir que limita toda la factura de Firestore y Firebase. [Control de gasto, actualizado el 20 de octubre de 2026](https://firebase.google.com/docs/projects/billing/avoid-surprise-bills).
- El pipeline de PR valida sin desplegar. El despliegue del proyecto demo lo hace la persona responsable de backend/integración, con credenciales de entorno y permisos mínimos. Nunca imprimir secretos en logs ni registrar texto privado completo de propuestas.

## 9. Entregas que permiten trabajar en paralelo

El reparto definitivo entre seis personas vive en el plan de trabajo. Para que Firebase no bloquee a Android, su responsable entrega primero:

1. DTO de propuesta, destinatario, error y ACK; JSON de ejemplo y nombres de estados.
2. Firmas de comandos: crear, responder, cancelar, registrar dispositivo y confirmar recepción/programación.
3. Repositorio falso con los mismos resultados y errores para el equipo Android.
4. Rules y fixtures del emulador; después handlers autenticados y transaccionales.
5. Procesamiento outbox/FCM y una prueba completa entre dos usuarios.

Cambiar una ruta, un enum o el significado de una versión exige actualizar contrato y fixtures en la misma PR, y avisar a los responsables de sincronización y alarmas. Las finanzas y el asistente se incorporan después del recorrido consentir → programar → sonar → detener; ninguna salida de IA escribe estados de consentimiento directamente.
