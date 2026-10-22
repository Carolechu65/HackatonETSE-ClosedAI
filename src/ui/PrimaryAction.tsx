import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { colors, layout, typography } from './theme.ts';

export type PrimaryActionProps = {
  /** Texto con la acción exacta: «Añadir gasto», nunca «Aceptar» u «OK». */
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Botón principal rojo, fuera de la hoja, a todo el ancho (`nevera-retro.md` §5.9). */
export function PrimaryAction({ label, onPress, disabled = false, style }: PrimaryActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cta,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={typography.button}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cta: {
    width: '100%',
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ac,
    borderRadius: layout.radius,
    borderWidth: 1,
    borderColor: colors.ln,
    paddingVertical: 13,
    paddingHorizontal: 12,
    marginTop: 14,
  },
  pressed: {
    opacity: 0.88,
  },
  disabled: {
    opacity: 0.55,
  },
});
