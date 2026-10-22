/**
 * Sistema visual compartido «Nevera Retro» (P1).
 *
 * P2 compone pantallas con estos primitivos; P6 reutiliza tokens en el widget.
 * Ninguna pantalla debe inventar colores, sombras o tipografías fuera de `theme.ts`.
 * La guía completa está en `nevera-retro.md` y el uso en `README.md`.
 */
export { Magnet } from './Magnet.tsx';
export { Note, type NoteProps } from './Note.tsx';
export { PrimaryAction, type PrimaryActionProps } from './PrimaryAction.tsx';
export { Screen, type ScreenProps } from './Screen.tsx';
export { ScreenHeader, type ScreenHeaderProps } from './ScreenHeader.tsx';
export { Sheet } from './Sheet.tsx';
export {
  colors,
  fallbackShadow,
  layout,
  magnets,
  noteStyleFor,
  paper,
  shadows,
  sheet,
  tabularNums,
  tilts,
  typography,
} from './theme.ts';
export { fontFamily, useNeveraFonts } from './fonts.ts';
