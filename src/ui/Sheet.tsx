import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Magnet } from './Magnet.tsx';
import { layout, sheet, shadows } from './theme.ts';

/**
 * Hoja grande de detalle y formularios (`nevera-retro.md` §5.8): papel menta,
 * imán rojo, inclinación suave. El botón principal va fuera de la hoja.
 */
export function Sheet({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.sheet, { transform: [{ rotate: `${sheet.tilt}deg` }] }, style]}>
      <Magnet color={sheet.magnet} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderRadius: layout.radius,
    backgroundColor: sheet.paper,
    paddingTop: layout.sheetPaddingTop,
    paddingHorizontal: layout.sheetPaddingHorizontal,
    paddingBottom: layout.sheetPaddingBottom,
    gap: 12,
    boxShadow: shadows.sheet,
  },
});
