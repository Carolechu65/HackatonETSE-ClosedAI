import { StyleSheet } from 'react-native';
import { Icon, type IconName } from './Icon.tsx';
import { PressableScale } from './PressableScale.tsx';
import { colors, layout } from './tokens.ts';

/** Botón cuadrado de acción (añadir, quitar): 36 px, radio 2 y color de texto. */
export function IconButton({
  name,
  onPress,
  accessibilityLabel,
  disabled = false,
  tone = 'filled',
}: {
  name: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
  tone?: 'filled' | 'plain';
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={[
        styles.button,
        tone === 'filled' ? styles.filled : styles.plain,
        disabled && styles.disabled,
      ]}
    >
      <Icon name={name} size={17} color={tone === 'filled' ? colors.onac : colors.ntx} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: layout.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filled: {
    backgroundColor: colors.ntx,
  },
  plain: {
    borderWidth: 1,
    borderColor: colors.noteLine,
  },
  disabled: {
    opacity: 0.35,
  },
});
