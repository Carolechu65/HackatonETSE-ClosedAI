import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { colors } from './tokens.ts';

/**
 * Interruptor de 38 × 20 px de la guía (§5.11): borde fino, relleno de acento cuando
 * está activo y bolita de 12 px que se desplaza con un muelle.
 */
export function Toggle({
  value,
  onToggle,
  accessibilityLabel,
}: {
  value: boolean;
  onToggle: () => void;
  accessibilityLabel: string;
}) {
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(progress, {
      toValue: value ? 1 : 0,
      useNativeDriver: false,
      speed: 20,
      bounciness: 6,
    }).start();
  }, [progress, value]);

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value }}
      hitSlop={10}
      onPress={onToggle}
      style={styles.hit}
    >
      <Animated.View
        style={[
          styles.track,
          {
            backgroundColor: progress.interpolate({
              inputRange: [0, 1],
              outputRange: ['rgba(43, 39, 35, 0)', colors.ac],
            }),
          },
        ]}
      >
        <Animated.View
          style={[
            styles.knob,
            {
              backgroundColor: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [colors.ntx, colors.onac],
              }),
              transform: [{
                translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }),
              }],
            },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    paddingVertical: 8,
    paddingLeft: 8,
  },
  track: {
    width: 38,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.ntx,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  knob: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.ntx,
  },
});
