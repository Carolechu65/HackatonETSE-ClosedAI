# Esqueleto de menús (rama `P1-Esqueleto`)

> Este esqueleto se conserva en `/preview`. El producto conectado usa las rutas de [ROUTES](ROUTES.md); [estado actual](qa/PRODUCT_INTEGRATION.md).

Prototipo navegable de P1 para acordar estructura visual e interacciones antes de conectar la API SQLite. **No hay datos reales**: todo el estado vive en memoria y se pierde al recargar. Ningún botón programa alarmas ni envía propuestas.

## Menús

La app pasa a cuatro pestañas con barra inferior fija (iconos de línea, sin emojis):

| Pestaña | Ruta | Qué permite |
|---|---|---|
| Tablón | `/` | Próxima tarea accionable, progreso del piso y saldo pendiente. |
| Gastos | `/gastos` | Ver deuda, añadir un gasto y marcar pagado. |
| Tareas | `/tareas` | Añadir, marcar y quitar tareas; progreso animado. |
| Piso | `/piso` | Quién está en casa y qué avisos acepta cada uno. |

Las pantallas ocupan el alto disponible **sin scroll**: el contenido está acotado a 460 dp y el tablón se limita a lo imprescindible. En pantallas muy pequeñas puede recortarse contenido secundario; no se añade scroll hasta tener diseño final con P2.

## Dónde está cada cosa

```text
app/preview/_layout.tsx      Tabs + barra propia
app/preview/{index,gastos,tareas,piso}.tsx
src/features/skeleton/model.ts    estado puro, reducer, selectores y formato de euros
src/features/skeleton/store.tsx   provider + acciones (memoria)
src/features/skeleton/components.tsx  ProgressBar, TaskRow, ExpenseRow
src/ui/RetroTabBar.tsx     barra inferior con iconos y subrayado animado
src/ui/{Checkbox,Toggle,Chip,TextField,IconButton,FlashMessage,PressableScale,AnimatedIn}.tsx
```

## Interacciones y animaciones

- **Pulsar**: todo baja un 5 % y vuelve con muelle (`PressableScale`).
- **Nota**: al mantener pulsada se endereza y sube 2 px; al soltar vuelve a su ángulo.
- **Casilla**: el relleno aparece con muelle y una marca; el texto se tacha.
- **Quitar tarea**: la fila se desliza y se desvanece antes de desaparecer del estado.
- **Añadir**: la fila nueva entra cayendo 8 px; confirmación efímera («Tarea añadida»).
- **Progreso**: la barra crece animada al marcar tareas.
- **Interruptor**: la bolita se desplaza y cambia de color al activarse.
- **Pestañas**: el icono crece y aparece el subrayado rojo al cambiar de menú.

## Qué falta y a quién corresponde

- P2 sustituye el contenido por propuestas reales y conserva esta navegación; `src/features/alarms/AlarmInboxScreen.tsx` sigue existiendo como referencia antigua.
- P5 cambia el store en memoria por SQLite + repositorio (`AlarmRepository`).
- P4 aporta la programación real; la nota de «alarma sonora» está marcada como no disponible a propósito.
- P3 valida las acciones de escritura con los contratos de `contracts/` antes de conectar la API SQLite.
- Cuando haya datos reales, revisar el límite de 4 filas visibles y decidir si el tablón necesita scroll o páginas.

## Comprobar

```sh
npm run web     # http://localhost:8081 (tablón, /gastos, /tareas, /piso)
npm test        # incluye tests del modelo del esqueleto
```
