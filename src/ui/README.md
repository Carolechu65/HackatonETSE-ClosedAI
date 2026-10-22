# Sistema visual · Nevera Retro (`src/ui`)

Implementación de [`nevera-retro.md`](../../nevera-retro.md) para React Native. **P1 es dueño de los tokens y primitivos; P2 compone pantallas; P6 reutiliza tokens en el widget.** Ninguna pantalla debe inventar colores, sombras o tipografías.

## Qué hay

| Archivo | Contenido |
|---|---|
| `tokens.ts` | Valores puros sin React Native: colores, papeles, imanes, inclinaciones, medidas y sombras. Sirve también para tests y para el widget. |
| `theme.ts` | Convierte los tokens en `TextStyle` con Fraunces y DM Mono. |
| `fonts.ts` | `Fraunces` + `DM Mono` con `expo-font` y la pila de respaldo. |
| `Screen.tsx` | Puerta de la nevera (`#efe2c4`) con área segura y margen lateral de 18 px. |
| `ScreenHeader.tsx` | Etiqueta en mayúsculas + título Fraunces 58 px, alineado a la izquierda. |
| `Note.tsx` | Nota de papel con imán centrado, inclinación por posición y tipografía. |
| `Sheet.tsx` | Hoja grande menta con imán rojo para detalle y formularios. |
| `PrimaryAction.tsx` | Botón rojo a todo el ancho, fuera de la hoja. |
| `Magnet.tsx` | Imán redondo con brillo; solo decoración. |
| `RetroTabBar.tsx` | Barra inferior con iconos de línea, etiquetas y subrayado animado. |
| `Checkbox.tsx`, `Toggle.tsx`, `Chip.tsx` | Controles con estado y animación de muelle. |
| `TextField.tsx`, `IconButton.tsx` | Formulario sin caja (solo línea inferior) y acción compacta. |
| `PressableScale.tsx`, `AnimatedIn.tsx`, `FlashMessage.tsx` | Feedback táctil, entrada de bloques y confirmación efímera. |
| `Avatar.tsx` | Círculo con inicial; relleno = presente. |

Referencia viva: `app/design.tsx` (ruta `/design`) muestra tablón, hoja de detalle, botón y pestañas con estos primitivos.

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

`tests/design.test.ts` comprueba contraste WCAG de cada papel, las secuencias de papel/imán/inclinación y las medidas base: si alguien cambia un token y rompe la guía, CI lo detecta.

## Pendiente

- P2 migra `AlarmInboxScreen` (todavía con estilos genéricos en memoria) y añade pestañas, filtros y chips con estos tokens.
- P6 acuerda con P1 la versión de `expo-widgets` y reutiliza los mismos colores de papel.
- No hay modo oscuro: la guía define una sola nevera. `userInterfaceStyle` es `light` en `app.config.ts`.
