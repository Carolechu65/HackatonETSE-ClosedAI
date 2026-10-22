import { useRef, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Magnet } from './Magnet.tsx';
import { layout, noteStyleFor, shadows, typography } from './theme.ts';

export type NoteProps = {
  /** Posición en el tablón: decide papel, imán e inclinación. */
  index?: number;
  /** Etiqueta en mayúsculas: `AVISO · HOY`. */
  label?: string;
  title: string;
  /** Ocupa las dos columnas del tablón. */
  wide?: boolean;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Si se pasa, la nota se puede pulsar: se endereza y sube 2 px mientras
   * se mantiene el dedo, como una nota real que se levanta de la puerta.
   */
  onPress?: () => void;
  accessibilityLabel?: string;
};

/**
 * Nota de papel (`nevera-retro.md` §5.4). El contenido lo decide el tipo de nota;
 * este componente solo garantiza papel, imán, inclinación y tipografía.
 */
export function Note({
  index = 0,
  label,
  title,
  wide = false,
  children,
  style,
  onPress,
  accessibilityLabel,
}: NoteProps) {
  const { backgroundColor, magnet, tilt } = noteStyleFor(index);
  const pressed = useRef(new Animated.Value(0)).current;

  const animate = (toValue: number) => {
    if (!onPress) return;
    Animated.spring(pressed, {
      toValue,
      useNativeDriver: true,
      speed: 35,
      bounciness: 4,
    }).start();
  };

  const animatedStyle = {
    backgroundColor,
    transform: [
      {
        rotate: pressed.interpolate({
          inputRange: [0, 1],
          outputRange: [`${tilt}deg`, '0deg'],
        }),
      },
      {
        translateY: pressed.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }),
      },
    ],
  };

  const content = (
    <>
      <Magnet color={magnet} />
      {label ? <Text style={typography.labelOnNote}>{label}</Text> : null}
      <Text style={typography.noteTitle}>{title}</Text>
      {children}
    </>
  );

  if (!onPress) {
    return (
      <Animated.View style={[styles.note, animatedStyle, wide && styles.wide, style]}>
        <View style={styles.body}>{content}</View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.note, animatedStyle, wide && styles.wide, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        onPress={onPress}
        onPressIn={() => animate(1)}
        onPressOut={() => animate(0)}
        style={styles.pressable}
      >
        {content}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  note: {
    borderRadius: layout.radius,
    boxShadow: shadows.paper,
  },
  body: {
    paddingTop: layout.notePaddingTop,
    paddingHorizontal: layout.notePaddingHorizontal,
    paddingBottom: layout.notePaddingBottom,
    gap: 4,
  },
  pressable: {
    paddingTop: layout.notePaddingTop,
    paddingHorizontal: layout.notePaddingHorizontal,
    paddingBottom: layout.notePaddingBottom,
    gap: 4,
  },
  wide: {
    width: '100%',
  },
});
