# Sistema visual · Nevera Retro (`src/ui`)

Implementación de [`nevera-retro.md`](../../nevera-retro.md) para React Native. **P1 es dueño de los tokens y primitivos; P2 compone pantallas; P6 reutiliza tokens en el widget.** Ninguna pantalla debe inventar colores, sombras o tipografías.

## Qué hay

| Archivo | Contenido |
|---|---|
| `theme.ts` | Colores, papeles, imanes, inclinaciones, márgenes, sombras, escala tipográfica. Valores accesibles de producción (`#bf3a2f`, `#6a5c48`, etiquetas al 72 %). |
| `fonts.ts` | `Fraunces` + `DM Mono` con `expo-font` y la pila de respaldo. |
| `Screen.tsx` | Puerta de la nevera (`#efe2c4`) con área segura y margen lateral de 18 px. |
| `ScreenHeader.tsx` | Etiqueta en mayúsculas + título Fraunces 58 px, alineado a la izquierda. |
| `Note.tsx` | Nota de papel con imán centrado, inclinación por posición y tipografía. |
| `Sheet.tsx` | Hoja grande menta con imán rojo para detalle y formularios. |
| `PrimaryAction.tsx` | Botón rojo a todo el ancho, fuera de la hoja. |
| `Magnet.tsx` | Imán redondo con brillo; solo decoración. |

## Uso

```tsx
import { Note, PrimaryAction, Screen, ScreenHeader, Sheet, typography } from '../ui/index.ts';

<Screen scroll>
  <ScreenHeader eyebrow="LA PUERTA DE LA NEVERA" title="Tablón" />
  <Note index={0} label="AVISO · HOY" title="El casero viene el martes">
    <Text style={typography.support}>Sube a las 10:00 y trae la llave.</Text>
  </Note>
  <Sheet>{/* detalle o formulario */}</Sheet>
  <PrimaryAction label="Añadir gasto" onPress={…} />
</Screen>
```

## Reglas que respeta

- Todo el contenido va sobre papel; el fondo es plano, sin degradados ni texturas.
- Un solo imán por nota, siempre centrado arriba y sobresaliendo 8 px.
- Papel, imán e inclinación salen de `noteStyleFor(index)`; no se eligen a mano y nunca se repite el color de dos notas contiguas.
- Títulos en Fraunces sin mayúsculas; etiquetas en DM Mono con `text-transform: uppercase`. Cifras y horas con `tabularNums`.
- Radios de 2 px; círculos solo en imanes y avatares.
- El rojo (`colors.ac`) solo en el botón principal, el subrayado activo y los imanes.
- Sin fotos, emojis, negro puro ni blanco puro.
- Objetivo táctil mínimo de 48 dp aunque el texto siga la escala de la guía.

## Pendiente

- P2 migra `AlarmInboxScreen` (todavía con estilos genéricos en memoria) y añade pestañas, filtros y chips con estos tokens.
- P6 acuerda con P1 la versión de `expo-widgets` y reutiliza los mismos colores de papel.
- No hay modo oscuro: la guía define una sola nevera. `userInterfaceStyle` es `light` en `app.config.ts`.
