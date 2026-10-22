# Rutas y deep links · contrato base

**Owner:** P1 (layout raíz, esquema y ruta desconocida). **Implementa:** P2 (pantallas y rutas de feature) y P6 (enlaces desde el widget). Este documento fija los nombres para que nadie invente URLs paralelas.

## Esquema

`app.config.ts` declara `scheme: "alarmat"`. Los enlaces externos usan `alarmat://…`; en desarrollo, Expo Router también acepta `exp+alarmat://expo-development-client/?url=…` sin cambiar las rutas.

| Ruta | Contenido | Owner |
|---|---|---|
| `/` | Tablón con propuestas y próximas alarmas | P2 |
| `/alarm/[requestId]` | Detalle de una propuesta: quién la propone, hora, estado por eje y acciones | P2 |
| `/alarm/[requestId]/respond` | Formulario de aceptar / otra hora / rechazar (opcional; puede ser un modal) | P2 |
| `/group/invite/[inviteId]` | Aceptar invitación al piso | P2 + P3 |
| `/task/[taskId]` | Detalle de tarea vinculada | P6 |
| `/design` | Catálogo de componentes del estilo (solo referencia; no es producto) | P1 |
| `/+not-found` | Enlace roto o entidad ya no visible | P1 |

Las rutas de gastos y huchas se añadirán con su contrato P1; no se crean carpetas vacías.

## Reglas

1. **Abrir un enlace no acepta nada.** El detalle muestra el estado vigente y las acciones; la aceptación exige pulsar y confirmar versión.
2. **Sin sesión no se muestran entidades.** El layout redirige a acceso y no reutiliza datos de una cuenta anterior.
3. **Una propuesta retirada, caducada o de otro miembro** termina en `/+not-found`, nunca en una pantalla con datos vacíos o ajenos.
4. **El widget abre la ruta del detalle**, no un formulario que responda solo. Las acciones directas se habilitan cuando P4/P5 puedan ejecutar el contrato completo.
5. Las rutas son finas: validan el parámetro y delegan en `src/features/*`. No contienen reglas de negocio ni llamadas a Firestore.

## Pendiente de acuerdo con P2/P6

- Si `/alarm/[requestId]/respond` será modal o ruta propia.
- Enlace del widget a propuestas pendientes frente a próximas alarmas (`?tab=…` si hace falta).
- Nombre definitivo de la ruta de tareas cuando P6 integre el widget.
