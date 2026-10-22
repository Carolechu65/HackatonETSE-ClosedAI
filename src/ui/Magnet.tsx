import { StyleSheet, View } from 'react-native';
import { colors, layout, shadows } from './theme.ts';

/**
 * Imán redondo con brillo plástico. Siempre uno por nota, centrado arriba y
 * sobresaliendo del papel. Es decoración: no lleva texto ni acción.
 */
export function Magnet({ color }: { color: string }) {
  return (
    <View accessible={false} importantForAccessibility="no" style={[styles.magnet, { backgroundColor: color }]}>
      <View style={styles.gloss} />
    </View>
  );
}

const styles = StyleSheet.create({
  magnet: {
    position: 'absolute',
    top: -layout.magnetOverhang,
    left: '50%',
    width: layout.magnetSize,
    height: layout.magnetSize,
    marginLeft: -layout.magnetSize / 2,
    borderRadius: layout.magnetSize / 2,
    boxShadow: shadows.magnet,
  },
  gloss: {
    position: 'absolute',
    top: 3,
    left: 3,
    width: layout.magnetSize * 0.45,
    height: layout.magnetSize * 0.45,
    borderRadius: layout.magnetSize * 0.225,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },
});
