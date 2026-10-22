import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, layout, paper } from './tokens.ts';
import { typography } from './theme.ts';

/** Chip de selección (guía §5.10): borde de 1 px y texto en mayúsculas. */
export function Chip({
  label,
  selected = false,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={onPress ? { selected } : undefined}
      hitSlop={8}
      onPress={onPress}
      style={[
        styles.chip,
        selected && styles.selected,
        !onPress && styles.static,
      ]}
    >
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderColor: colors.ntx,
    borderRadius: layout.radius,
    paddingHorizontal: 9,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  selected: {
    backgroundColor: colors.ntx,
  },
  static: {
    borderColor: colors.noteLine,
  },
  label: {
    ...typography.labelOnNote,
    fontSize: 10,
    color: colors.ntx,
  },
  labelSelected: {
    color: paper[0],
  },
});
