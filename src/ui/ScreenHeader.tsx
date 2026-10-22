import { StyleSheet, Text, View } from 'react-native';
import { BrandMark } from './BrandMark.tsx';
import { typography } from './theme.ts';

export type ScreenHeaderProps = {
  /** Etiqueta superior en mayúsculas: «LA PUERTA DE LA NEVERA». */
  eyebrow?: string;
  /** Título en Fraunces, sin mayúsculas. La pantalla principal es «Tablón». */
  title: string;
  /** Sustituye la etiqueta por el logotipo (pantalla de inicio). */
  brand?: boolean;
};

/** Cabecera alineada a la izquierda (`nevera-retro.md` §5.2). */
export function ScreenHeader({ eyebrow, title, brand = false }: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      {brand ? <BrandMark width={176} /> : eyebrow ? <Text style={typography.label}>{eyebrow}</Text> : null}
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
