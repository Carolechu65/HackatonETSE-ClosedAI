import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { colors } from './tokens.ts';
import { typography } from './theme.ts';

/**
 * Confirmación efímera de una acción («Tarea añadida», «Gasto pagado»).
 * Aparece y se desvanece sola; no ocupa sitio cuando no hay mensaje.
 * Cambia la `key` para repetir el mismo texto.
 */
export function FlashMessage({
  message,
  style,
}: {
  message: string | null;
  style?: StyleProp<TextStyle>;
}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    const animation = Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 260, delay: 1500, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [message, opacity]);

  if (!message) return null;

  return (
    <Animated.Text accessibilityLiveRegion="polite" style={[styles.text, style, { opacity }]}>
      {message}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  text: {
    ...typography.label,
    color: colors.mu,
  },
});
