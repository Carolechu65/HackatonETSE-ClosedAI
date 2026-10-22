/**
 * Estilos de React Native para «Nevera Retro».
 *
 * Los valores puros (color, papel, imán, medidas) viven en `tokens.ts`; aquí se
 * convierten en `TextStyle` con las tipografías cargadas por `fonts.ts`.
 * La guía completa está en `nevera-retro.md` y el uso en `README.md`.
 */
import type { TextStyle, ViewStyle } from 'react-native';
import { fontFamily } from './fonts.ts';
import { colors } from './tokens.ts';

export {
  colors,
  layout,
  magnets,
  noteStyleFor,
  paper,
  shadows,
  sheet,
  tilts,
} from './tokens.ts';

/** Sombra cálida de reserva para motores sin `boxShadow` (RN antiguo). */
export const fallbackShadow: ViewStyle = {
  shadowColor: '#281e14',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.28,
  shadowRadius: 8,
  elevation: 3,
};

export const typography = {
  screenTitle: {
    fontFamily: fontFamily.display,
    fontSize: 58,
    lineHeight: 58 * 0.9,
    letterSpacing: -0.9,
    color: colors.tx,
  },
  detailTitle: {
    fontFamily: fontFamily.display,
    fontSize: 45,
    lineHeight: 45 * 0.92,
    color: colors.ntx,
  },
  noteTitle: {
    fontFamily: fontFamily.display,
    fontSize: 19,
    lineHeight: 19 * 1.02,
    color: colors.ntx,
  },
  amount: {
    fontFamily: fontFamily.display,
    fontSize: 30,
    lineHeight: 30 * 0.95,
    color: colors.ntx,
    fontVariant: ['tabular-nums'],
  },
  field: {
    fontFamily: fontFamily.display,
    fontSize: 24,
    lineHeight: 24 * 1.1,
    color: colors.ntx,
  },
  label: {
    fontFamily: fontFamily.bodyStrong,
    fontSize: 9.5,
    letterSpacing: 1.52,
    textTransform: 'uppercase',
    color: colors.mu,
  },
  labelOnNote: {
    fontFamily: fontFamily.bodyStrong,
    fontSize: 9.5,
    letterSpacing: 1.52,
    textTransform: 'uppercase',
    color: colors.noteLabel,
  },
  body: {
    fontFamily: fontFamily.body,
    fontSize: 12,
    lineHeight: 12 * 1.55,
    color: colors.ntx,
  },
  bodyStrong: {
    fontFamily: fontFamily.bodyStrong,
    fontSize: 12,
    lineHeight: 12 * 1.55,
    color: colors.ntx,
  },
  bodyOnDoor: {
    fontFamily: fontFamily.body,
    fontSize: 12,
    lineHeight: 12 * 1.55,
    color: colors.tx,
  },
  support: {
    fontFamily: fontFamily.body,
    fontSize: 11,
    lineHeight: 11 * 1.55,
    color: colors.noteMuted,
  },
  tab: {
    fontFamily: fontFamily.bodyStrong,
    fontSize: 9.5,
    letterSpacing: 1.33,
    textTransform: 'uppercase',
    color: colors.mu,
  },
  tabActive: {
    fontFamily: fontFamily.bodyStrong,
    fontSize: 9.5,
    letterSpacing: 1.33,
    textTransform: 'uppercase',
    color: colors.tx,
    textDecorationLine: 'underline',
    textDecorationColor: colors.ac,
    textDecorationStyle: 'solid',
  },
  button: {
    fontFamily: fontFamily.bodyStrong,
    fontSize: 10.5,
    letterSpacing: 1.68,
    textTransform: 'uppercase',
    color: colors.onac,
  },
} satisfies Record<string, TextStyle>;

/** Estilo de texto con `tabular-nums` para cifras, horas y recuentos. */
export const tabularNums: TextStyle = { fontVariant: ['tabular-nums'] };
