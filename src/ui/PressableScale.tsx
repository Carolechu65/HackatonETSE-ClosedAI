import { useRef, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  type AccessibilityProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export type PressableScaleProps = {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityProps['accessibilityRole'];
  accessibilityState?: AccessibilityProps['accessibilityState'];
  hitSlop?: number;
};

/** Feedback táctil: el contenido se hunde un 5 % al pulsarlo y vuelve con muelle. */
export function PressableScale({
  children,
  onPress,
  onLongPress,
  disabled = false,
  style,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
  hitSlop = 6,
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (toValue: number) => {
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 45,
      bounciness: 5,
    }).start();
  };

  return (
    <Animated.View style={[style, { transform: [{ scale }] }]}>
      <Pressable
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
        disabled={disabled}
        hitSlop={hitSlop}
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={() => animateTo(0.95)}
        onPressOut={() => animateTo(1)}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
