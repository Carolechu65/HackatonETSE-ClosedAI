import { StyleSheet, Text, View } from 'react-native';
import { typography } from './theme.ts';

export type ScreenHeaderProps = {
  /** Etiqueta superior en mayúsculas: «LA PUERTA DE LA NEVERA». */
  eyebrow: string;
  /** Título en Fraunces, sin mayúsculas. La pantalla principal es «Tablón». */
  title: string;
};

/** Cabecera alineada a la izquierda (`nevera-retro.md` §5.2). */
export function ScreenHeader({ eyebrow, title }: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      <Text style={typography.label}>{eyebrow}</Text>
      <Text accessibilityRole="header" style={typography.screenTitle}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    marginTop: 8,
    marginBottom: 16,
    alignItems: 'flex-start',
    gap: 6,
  },
});
