/**
 * Tokens puros de «Nevera Retro» (`nevera-retro.md`), sin dependencias de React Native.
 *
 * Se pueden importar desde tests de Node, desde el widget (P6) o desde cualquier
 * consumidor que solo necesite color y medidas. Los estilos de React Native viven
 * en `theme.ts`.
 *
 * Reglas que estos valores hacen cumplir:
 * - El fondo es la puerta (`wall`) y todo el contenido va sobre papel.
 * - Papel, imán e inclinación siguen sus secuencias por posición.
 * - El rojo solo aparece en el botón principal, el subrayado activo y los imanes.
 * - Se usan los valores accesibles de producción de la guía (2.5).
 */

export const colors = {
  /** Puerta de la nevera. */
  wall: '#efe2c4',
  /** Texto sobre la puerta. */
  tx: '#3b2a1a',
  /** Secundario accesible sobre la puerta (5,05:1). */
  mu: '#6a5c48',
  /** Secundario decorativo original de la guía (3,74:1). No usar en texto pequeño. */
  muSoft: '#7f705b',
  /** Líneas finas sobre la puerta. */
  ln: '#c4b69b',
  /** Acento accesible: texto sobre el botón a 5,09:1. */
  ac: '#bf3a2f',
  /** Rojo decorativo original (imanes y subrayados). */
  acDecorative: '#d9473b',
  onac: '#fff6ec',
  /** Texto dentro de las notas. */
  ntx: '#2b2723',
  noteMuted: 'rgba(43, 39, 35, 0.78)',
  /** Etiquetas al 74 %: 4,64:1 en el papel más claro para texto. */
  noteLabel: 'rgba(43, 39, 35, 0.74)',
  noteLine: 'rgba(43, 39, 35, 0.20)',
  noteTrack: 'rgba(43, 39, 35, 0.12)',
  /** Inicial sobre avatar relleno. */
  onAvatar: '#fff8ef',
} as const;

export const paper = ['#f5df9a', '#bfe0cf', '#f2b8b0', '#bcd6e6', '#f7f0e1', '#e9c9a7'] as const;
export const magnets = ['#d9473b', '#2f7d6d', '#e8a33a', '#3c6ea8', '#d9473b', '#2f7d6d'] as const;

/** Inclinación por posición. Nunca supera 2°. */
export const tilts = [-1.6, 1.2, 0.8, -1, 1.5, -0.7] as const;

/** Hoja grande de detalle y formularios: menta con imán rojo. */
export const sheet = {
  paper: paper[1],
  magnet: magnets[0],
  tilt: -0.6,
} as const;

export const layout = {
  gutter: 18,
  noteGapRow: 16,
  noteGapColumn: 10,
  radius: 2,
  notePaddingTop: 18,
  notePaddingHorizontal: 10,
  notePaddingBottom: 12,
  sheetPaddingTop: 22,
  sheetPaddingHorizontal: 14,
  sheetPaddingBottom: 16,
  magnetSize: 20,
  magnetOverhang: 8,
  /** Objetivo táctil mínimo (accesibilidad, no estilo). */
  minTouchTarget: 48,
} as const;

/** Sombras cálidas y cortas: el papel está pegado a la puerta, no flota. */
export const shadows = {
  paper: '0 1px 1px rgba(40,30,20,0.12), 0 6px 14px -8px rgba(40,30,20,0.40)',
  sheet: '0 1px 1px rgba(40,30,20,0.12), 0 10px 20px -10px rgba(40,30,20,0.45)',
  magnet: '0 2px 3px rgba(0,0,0,0.35)',
} as const;

/** Devuelve papel, imán e inclinación de la posición `index` (0-based). */
export function noteStyleFor(index: number): { backgroundColor: string; magnet: string; tilt: number } {
  const position = ((index % 6) + 6) % 6;
  return {
    backgroundColor: paper[position]!,
    magnet: magnets[position]!,
    tilt: tilts[position]!,
  };
}
