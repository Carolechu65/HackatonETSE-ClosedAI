# P6 · Demo e integración

> Actualización: la composición real ya está integrada. Véase [recorrido y evidencia](qa/PRODUCT_INTEGRATION.md). Las notas de entrega inicial siguientes conservan contexto histórico.

Guion de tres minutos y registro de evidencia. **Nada de este documento afirma que la
alarma suene**: la compilación y la prueba física están pendientes y se marcan como tal.

## Guion (3 min)

| t | Acción | Qué debe verse |
|---|---|---|
| 0:00 | Mostrar el tablón de tareas (`TaskPreview` o `/task/demo-task-1`) | Notas de papel con responsable por UID, vencimiento y versión. Etiqueta DEMO si son fixtures. |
| 0:20 | Abrir una tarea pendiente y pulsar «Completar tarea» | La tarea pasa a completada; la retirada de alarmas queda **pendiente de acuse**. |
| 0:35 | Repetir el toque / reintentar | No hay segunda invalidación ni sube la versión (idempotencia). |
| 0:45 | Volver y abrir una tarea de otro grupo (`/task/ajena`) | `/+not-found`; no se filtra que existe. |
| 1:00 | Abrir `/widget-lab` (pestaña Piso → «Abrir laboratorio del widget») | Simulación con los cuatro estados; en Android, publicar en el widget real y volver al launcher. |
| 1:10 | Abrir el widget en el launcher (build Android) | Próxima alarma confirmada, contadores y frescura. Sin botones que finjan navegar. |
| 1:20 | Cambiar de grupo / cerrar sesión y publicar snapshot | El widget queda vacío: sin títulos ni contadores del usuario anterior. |
| 1:40 | Aceptar una propuesta sin programar (bandeja de P2) | El widget **no** la muestra como próxima alarma; sube «por activar». |
| 2:00 | Rechazar / cancelar con el receptor offline (cuando P3/P4 estén) | Se ve retirada pendiente, no cancelación aplicada. |
| 2:30 | Cierre | Límites declarados: deep link del widget bloqueado por la librería; sesión y repositorio pendientes. |

Casos de rechazo incluidos: enlace inválido, entidad ajena, doble completado, snapshot
antiguo. Reinicio de datos: la demo en memoria se reinicia al recargar la app.

## Registro de evidencia

| Fecha | Build / commit | Dispositivo (modelo, API) | Paso | Resultado |
|---|---|---|---|---|
| 2026-10-22 | `feat/p6-widget-tasks-demo` (sin build) | — | `npm run typecheck`, `npm test`, `npm run test:contracts` | Pendiente de anotar tras el cierre del incremento |
| — | — | — | Instalar development build y añadir widget al launcher | **Pendiente**: requiere Android Studio/SDK y dispositivo |
| — | — | — | Actualizar widget con la app cerrada | **Pendiente** de dispositivo |
| — | — | — | Abrir `alarmat://task/…` desde fuera | **Pendiente** de build; validado en unit tests el parseo y el control de acceso |
| — | — | — | Prueba entre dos móviles (A propone, B acepta, B programa) | **Pendiente** de P3/P4 |

Distinguir siempre: grabación, simulación (fixtures) y ejecución real. La vista local de
diseño (`Hackaton/preview`, fuera del repo) es simulación, no build.

## Limitación verificada del widget

`expo-widgets@58.0.22` en Android convierte los botones del widget en un broadcast que
solo reevalúa props; no abre la app. Evidencia: `WidgetInteractionAction.kt` y
`WidgetsUtils.kt` del paquete instalado. Consecuencia para la demo: el widget informa,
no navega. El deep link queda en `props.alarmUrl` y en el contrato `links.ts` para la
notificación de P4 o para una acción nativa acordada con P1 (ver handoff).

## Qué no se puede afirmar todavía

- Que el widget se instale o refresque con la app cerrada.
- Que aceptar programe una alarma (eso es P4 + acuse de P5).
- Que completar una tarea cancele alarmas en un dispositivo real.
- Que el aviso suene con pantalla bloqueada o tras force-stop.

Pasar `npm run check` no demuestra ninguna de esas cuatro cosas.
