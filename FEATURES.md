# Funcionalidades — alarmaT

Nombre propuesto del producto: **alarmaT**. Repositorio: **HackatonETSE-ClosedAI**. App Android para proponer alarmas y notificaciones a otras personas y permitirles aceptar, rechazar o elegir otra hora. Widgets y tareas acompañan ese núcleo; gastos e huchas son módulos secundarios.

**Estado:** alcance previsto. La implementación integrada y sus límites están documentados en [el registro P1–P6](docs/qa/PRODUCT_INTEGRATION.md); las casillas aún no certifican aceptación física. Arquitectura y decisiones tecnológicas en [README.md](README.md).

**Tecnología acordada:** Expo, React Native, TypeScript, Expo Router y expo-widgets; API HTTPS propia Node.js/Fastify con SQLite en el VPS y autenticación propia. expo-sqlite conserva datos locales del móvil; expo-notifications gestiona avisos. Push remoto opcional mediante Expo Push Service (FCM como transporte Android), sin Firebase Auth/Firestore/Functions ni RNFirebase. El runtime nativo mantiene las alarmas sonoras. La API SQLite está en `server/`; el código Firebase se conserva como legado.

## Prioridades

- **P0 — MVP:** enviar una propuesta a otro móvil, aceptar/rechazar/cambiar hora, programar el aviso local y reflejar su estado en un widget.
- **P1 — siguiente iteración:** coordinación avanzada de tareas, IA, gastos, huchas y presupuestos tras validar las alarmas.
- **P2 — ampliaciones:** fuera del compromiso inicial del hackathon.

## 1. Alarmas, notificaciones y aceptación personal

### Acciones del usuario

- [ ] **P0** Crear una propuesta para uno o varios miembros conectados al grupo.
- [ ] **P0** Definir título, fecha, hora, zona horaria y modalidad de aviso.
- [ ] **P0** Crear avisos independientes o asociados a una tarea.
- [ ] **P0** Mostrar quién propone el aviso y a quién va dirigido.
- [ ] **P0** Distinguir envío, recepción, aceptación y programación en el dispositivo.
- [ ] **P0** Mantener una respuesta y horario independiente por destinatario.
- [ ] **P0** Marcar propuestas caducadas si ya pasó su hora; ofrecer otra hora sin activarlas automáticamente.
- [ ] **P0** Mostrar cambios y cancelaciones remotas pendientes cuando el móvil receptor no los haya confirmado.

- [ ] **P0** Recibir una propuesta con motivo, fecha, hora y tarea asociada cuando exista.
- [ ] **P0** **Aceptar:** autorizar que se programe el recordatorio en su móvil.
- [ ] **P0** **Rechazar:** mantener el aviso desactivado para esa persona.
- [ ] **P0** **Otra hora:** elegir un horario propio sin modificar el vencimiento de la tarea.
- [ ] **P0** **Desactivar:** cancelar un aviso previamente aceptado.
- [ ] **P0** Posponer un aviso sin cambiar la tarea.
- [ ] **P0** Elegir entre aceptar solo esa ocasión o futuros recordatorios con la misma configuración.
- [ ] **P0** Mostrar el estado de aceptación y el de programación efectiva en el móvil.
- [ ] **P0** Cancelar los avisos pendientes cuando la tarea se completa o cancela.
- [ ] **P0** Elegir si recibir notificaciones de nuevas propuestas y silenciar las de un miembro.
- [ ] **P1** Personalizar sonido y vibración, respetando la configuración de Android.
- [ ] **P0** Validar una alarma sonora programada con los permisos requeridos y acciones de detener o posponer.
- [ ] **P0** Mantener una modalidad de recordatorio estándar diferenciada de la alarma sonora.
- [ ] **P0** Probar cierre de proceso, pantalla bloqueada, reinicio, ahorro de batería y falta de conexión.
- [ ] **P0** Usar un dispositivo de alarma principal por destinatario en el MVP.

### Reglas de funcionamiento

1. Una propuesta sin respuesta permanece inactiva.
2. Aceptar no activa avisos para los demás miembros.
3. Rechazar un aviso no cancela la tarea ni cambia su responsable.
4. Para cambiar el compromiso se utiliza «No puedo» o «Proponer cambio».
5. La app y el widget muestran las propuestas; un aviso adicional para revisarlas depende de la preferencia del usuario.
6. Una autorización recurrente se aplica solo a la configuración aceptada. Si esta cambia, debe confirmarse de nuevo.
7. Si faltan permisos o la programación falla, el aviso aparece como aceptado pero pendiente de activación. No se muestra como programado.
8. Cambiar la hora sustituye la programación anterior; repetir una aceptación no duplica avisos.
9. Desactivar o rechazar una propuesta sustituye cualquier programación anterior de esa propuesta, sin afectar a los avisos de otros miembros.

```text
🔔 RECORDATORIO PROPUESTO
Sacar la basura · hoy a las 21:00
¿Quieres que te avisemos a las 20:30?
[Aceptar] [Otra hora] [Rechazar]
```

La aceptación es una decisión de producto. El permiso de notificaciones de Android es un requisito técnico adicional. El MVP debe validar notificaciones estándar y alarmas sonoras, distinguiendo sus permisos y límites. No se garantiza sonar con el teléfono apagado, tras una detención forzada o ignorando la configuración de Android.

## 2. Gestión del grupo o piso

- [ ] **P0** Crear un piso con nombre, moneda y zona horaria.
- [ ] **P0** Invitar miembros y permitir que se unan al grupo.
- [ ] **P0** Limitar el acceso a la información a los miembros del piso.
- [ ] **P0** Consultar quién realizó cada cambio y cuándo.
- [ ] **P0** Sincronizar cambios entre dispositivos.
- [ ] **P0** Conservar acciones pendientes cuando no haya conexión y reconciliarlas al recuperarla.
- [ ] **P1** Definir acuerdos básicos sobre rotaciones y reparto de responsabilidades.
- [ ] **P1** Administrar varios pisos, viajes o grupos desde una misma cuenta.

## 3. Tareas y organización

- [ ] **P0** Crear tareas con título, descripción, categoría y responsable.
- [ ] **P0** Programar fecha y hora de asignación o activación.
- [ ] **P0** Establecer fecha y hora límite independientes del recordatorio.
- [ ] **P0** Repetir tareas semanalmente.
- [ ] **P1** Rotar responsables según un orden acordado.
- [ ] **P0** Mostrar tareas propias y tareas del piso.
- [ ] **P0** Marcar tareas como completadas y conservar su historial.
- [ ] **P0** Identificar las tareas vencidas.
- [ ] **P1** Registrar ausencias o disponibilidad declarada.
- [ ] **P1** Solicitar un cambio de fecha o intercambio mediante «No puedo».
- [ ] **P1** Mantener el compromiso original hasta que los afectados acepten el cambio.
- [ ] **P1** Comparar carga mediante minutos o puntos de esfuerzo acordados.
- [ ] **P1** Repetir tareas diariamente o en días específicos de la semana.
- [ ] **P1** Filtrar por categoría, responsable, fecha y estado.

## 4. Gastos compartidos — estilo Tricount

- [ ] **P1** Registrar importe, concepto, categoría, fecha y persona que pagó.
- [ ] **P1** Seleccionar los participantes de cada gasto.
- [ ] **P1** Dividir un gasto a partes iguales.
- [ ] **P1** Repartir por importes personalizados cuya suma coincida con el total.
- [ ] **P1** Mostrar cuánto adelantó y cuánto debe asumir cada persona.
- [ ] **P1** Consultar saldos a favor y cantidades pendientes.
- [ ] **P1** Sugerir transferencias para liquidar saldos.
- [ ] **P1** Registrar liquidaciones realizadas y consultar su historial.
- [ ] **P1** Calcular en céntimos y distribuir redondeos de manera consistente.
- [ ] **P2** Repartir por porcentajes.
- [ ] **P2** Admitir varias monedas y reglas de conversión.

Tricount es una referencia de experiencia, no una integración requerida. Registrar una liquidación no ejecuta una transferencia bancaria.

## 5. Categorías y presupuestos

- [ ] **P1** Crear categorías personalizadas, como alimentación, limpieza o suministros.
- [ ] **P1** Asignar un presupuesto mensual a una categoría.
- [ ] **P1** Mostrar gasto acumulado y presupuesto restante del periodo.
- [ ] **P1** Reflejar los gastos de la categoría, incluidos los pagados desde una hucha.
- [ ] **P1** Avisar al alcanzar un umbral configurable del presupuesto.
- [ ] **P1** Comparar periodos anteriores.

El presupuesto representa un límite o plan de gasto. No significa que ese dinero exista en una hucha.

## 6. Huchas compartidas

- [ ] **P1** Crear una hucha con categoría y participantes.
- [ ] **P1** Establecer un objetivo de ahorro y fecha objetivo opcionales.
- [ ] **P1** Registrar aportaciones por persona.
- [ ] **P1** Diferenciar aportaciones previstas de realizadas.
- [ ] **P1** Registrar retiradas y gastos pagados con la hucha.
- [ ] **P1** Mostrar saldo acumulado, cantidad restante y progreso hacia el objetivo.
- [ ] **P1** Consultar el historial de movimientos.
- [ ] **P1** Evitar que un gasto de hucha genere también una deuda personal duplicada.
- [ ] **P1** Proponer un plan de aportaciones para llegar al objetivo.

Las huchas son un registro virtual. Aportar a la hucha no consume presupuesto; gastar desde ella sí consume el presupuesto de la categoría correspondiente.

## 7. Widgets Android

- [ ] **P0** Mostrar próximas alarmas aceptadas, hora efectiva, emisor y estado de programación.
- [ ] **P0** Dar acceso a detener, posponer o desactivar avisos propios.

- [ ] **P0** Mostrar próximas tareas, responsable y vencimiento.
- [ ] **P0** Ofrecer acciones para completar una tarea asociada, posponer un aviso o cambiar su hora.
- [ ] **P0** Mostrar propuestas de recordatorio con acceso a aceptar, rechazar o elegir otra hora.
- [ ] **P1** Mostrar propuestas de intercambio pendientes.
- [ ] **P0** Indicar última sincronización y cambios pendientes de confirmar.
- [ ] **P0** Abrir la pantalla concreta cuando una operación necesite más información.
- [ ] **P1** Mostrar saldo personal y acceso para añadir un gasto o liquidación.
- [ ] **P1** Mostrar presupuesto disponible de una categoría.
- [ ] **P1** Mostrar progreso de una hucha y acceso para registrar aportaciones.
- [ ] **P1** Permitir elegir categoría o hucha visible.

Las acciones directamente ejecutables con la app cerrada deben validarse en Android. Si requieren abrir la app en el primer prototipo, debe quedar claro en la demo.

## 8. Coordinador inteligente

- [ ] **P1** Interpretar una petición sencilla como «esta semana estoy fuera».
- [ ] **P1** Consultar disponibilidad declarada, tareas y acuerdos.
- [ ] **P1** Proponer intercambios válidos según esas restricciones.
- [ ] **P1** Explicar los datos y acuerdos que justifican una propuesta.
- [ ] **P1** Solicitar la aceptación de los afectados antes de cambiar compromisos existentes.
- [ ] **P1** Preguntar solo el dato pendiente que impide avanzar.
- [ ] **P1** Indicar cuándo no encuentra una alternativa válida.
- [ ] **P1** Conservar las funciones básicas si el modelo no responde.
- [ ] **P1** Convertir una corrección en una propuesta de acuerdo reutilizable y versionado.
- [ ] **P1** Pedir aclaración sobre participantes o conceptos ambiguos de un gasto.
- [ ] **P1** Priorizar el contenido de los widgets entre plantillas predefinidas.

Los cálculos de dinero y las validaciones se ejecutan mediante código. El modelo no inventa datos, decide unilateralmente qué es justo ni activa recordatorios sin consentimiento.

## 9. Ampliaciones posteriores

- [x] **P2** Escanear recibos con OCR local, conservar el original y revisar comercio, fecha e importe antes de guardar; cámara/archivos en Android y web.
- [ ] **P2** Integrar calendarios externos.
- [ ] **P2** Publicar una versión iOS.

Pagos bancarios reales, lectura automática de chats privados, biometría y un agente permanente por miembro quedan fuera del alcance actual.

## Recorrido mínimo para validar el MVP

Crear grupo → invitar miembro → enviarle una propuesta de alarma → aceptar/rechazar/elegir otra hora → programar en el móvil receptor → confirmar estado al emisor → mostrar widget → disparar y detener o posponer el aviso.

Después de este recorrido se incorporan coordinación avanzada de tareas, gastos, presupuestos e huchas.

La demo debe mostrar al menos un aviso rechazado que no se programa, uno aceptado que sí se programa y un cambio de hora que no modifica la fecha límite de la tarea.

## Conexiones personales de IA · 24-10-2026

- [x] Ajustes → Conectar mi IA: OpenAI (GPT-6 Luna), OpenCode (DeepSeek), DeepSeek directo y OpenRouter, con modelo editable.
- [x] Prueba pequeña con aviso de coste; guardado posterior sin nueva llamada al proveedor.
- [x] API keys cifradas por usuario, máscara parcial, sustitución y eliminación; sin clave global ni uso de conexiones ajenas.
- [x] Propuestas revisables y consentimiento independiente; el receptor no necesita conectar una IA.
- [x] OCR local para JPG, PNG y PDF sin credenciales externas; importes ambiguos quedan pendientes de revisión.
- [x] Descarga directa del APK desde el login y el pie del tablón web.

Detalles técnicos y límites: [IA personal](docs/PERSONAL_AI.md) y [OCR](deploy/RECEIPT_OCR.md).
