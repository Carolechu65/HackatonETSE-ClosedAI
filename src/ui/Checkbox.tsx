import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Icon } from './Icon.tsx';
import { colors, layout } from './tokens.ts';

/**
 * Casilla de la lista de la compra / tareas: cuadrado de 11 px que se rellena
 * y crece ligeramente al marcarse. Sin animación de color: solo escala y opacidad.
 */
export function Checkbox({
  checked,
  onToggle,
  accessibilityLabel,
  size = 16,
}: {
  checked: boolean;
  onToggle: () => void;
  accessibilityLabel: string;
  size?: number;
}) {
  const progress = useRef(new Animated.Value(checked ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(progress, {
      toValue: checked ? 1 : 0,
      useNativeDriver: true,
      speed: 22,
      bounciness: 9,
    }).start();
  }, [checked, progress]);

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked }}
      hitSlop={10}
      onPress={onToggle}
      style={styles.hit}
    >
      <View style={[styles.box, { width: size, height: size }]}>
        <Animated.View
          style={[
            styles.fill,
            {
              opacity: progress,
              transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
            },
          ]}
        >
          <Icon name="check" size={size - 6} color={colors.onAvatar} />
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    minWidth: layout.minTouchTarget,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
  },
  box: {
    borderWidth: 1,
    borderColor: colors.ntx,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  fill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.ntx,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
