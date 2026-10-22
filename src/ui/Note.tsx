import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
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
};

/**
 * Nota de papel (`nevera-retro.md` §5.4). El contenido lo decide el tipo de nota;
 * este componente solo garantiza papel, imán, inclinación y tipografía.
 */
export function Note({ index = 0, label, title, wide = false, children, style }: NoteProps) {
  const { backgroundColor, magnet, tilt } = noteStyleFor(index);
  return (
    <View
      style={[
        styles.note,
        { backgroundColor, transform: [{ rotate: `${tilt}deg` }] },
        wide && styles.wide,
        style,
      ]}
    >
      <Magnet color={magnet} />
      {label ? <Text style={typography.labelOnNote}>{label}</Text> : null}
      <Text style={typography.noteTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    borderRadius: layout.radius,
    paddingTop: layout.notePaddingTop,
    paddingHorizontal: layout.notePaddingHorizontal,
    paddingBottom: layout.notePaddingBottom,
    gap: 4,
    boxShadow: shadows.paper,
  },
  wide: {
    width: '100%',
  },
});
