import { StyleSheet, Text, View } from 'react-native';
import { colors } from './tokens.ts';
import { typography } from './theme.ts';

/**
 * Avatar circular con inicial (guía §5.7). Relleno = presente / participa;
 * vacío = no ha respondido o no está.
 */
export function Avatar({
  initial,
  filled = false,
  size = 24,
}: {
  initial: string;
  filled?: boolean;
  size?: number;
}) {
  return (
    <View
      accessible={false}
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: filled ? colors.ntx : 'transparent',
        },
      ]}
    >
      <Text
        style={[
          typography.labelOnNote,
          styles.initial,
          { color: filled ? colors.onAvatar : colors.ntx, fontSize: size >= 32 ? 12 : 10 },
        ]}
      >
        {initial}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    borderWidth: 1,
    borderColor: colors.ntx,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    letterSpacing: 0,
  },
});
