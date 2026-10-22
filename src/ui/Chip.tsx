import { StyleSheet, Text, View } from 'react-native';
import { PressableScale } from './PressableScale.tsx';
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
  const chipStyle = [styles.chip, selected && styles.selected, !onPress && styles.static];
  const content = <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>;

  if (!onPress) {
    return <View style={chipStyle}>{content}</View>;
  }

  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      style={chipStyle}
    >
      {content}
    </PressableScale>
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
