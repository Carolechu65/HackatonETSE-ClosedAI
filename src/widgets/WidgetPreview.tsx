import { StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../ui/index.ts';
import type { AlarmaTWidgetProps } from './viewModel.ts';

export type WidgetPreviewProps = {
  props: AlarmaTWidgetProps;
  /** Ancho simulado del widget 4×2 en el launcher. */
  width?: number;
};

/**
 * Simulación visual del widget para el laboratorio (`/widget-lab`).
 *
 * No es el widget nativo: reproduce en React Native la misma composición y los
 * mismos textos que pinta `AlarmaTWidget.tsx`. Sirve para revisar estados en web
 * y en el propio móvil sin añadir el widget al launcher. Publicar de verdad solo
 * ocurre con los botones del laboratorio en una development build Android.
 */
export function WidgetPreview({ props, width = 320 }: WidgetPreviewProps) {
  const freshness = props.stale
    ? 'SIN CONEXIÓN'
    : props.freshness === 'ahora mismo'
      ? 'AHORA'
      : props.freshness.toUpperCase();

  return (
    <View style={styles.launcher} accessible accessibilityLabel={`Simulación del widget: ${props.headline}`}>
      <View style={[styles.widget, { width }]}>
        <View style={styles.topRow}>
          <Text style={styles.eyebrow}>ALARMAT</Text>
          <Text style={styles.eyebrow}>{freshness}</Text>
        </View>

        <View style={styles.paper}>
          <View style={styles.magnet} />
          <View style={styles.body}>
            <Text numberOfLines={2} style={styles.headline}>
              {props.headline}
            </Text>
            <Text numberOfLines={2} style={props.when.length > 0 ? styles.when : styles.emptyBody}>
              {props.when.length > 0 ? props.when : props.emptyBody}
            </Text>
          </View>
        </View>

        <Text numberOfLines={2} style={styles.pending}>
          {props.pending}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  launcher: {
    backgroundColor: '#1a2233',
    borderRadius: 12,
    paddingVertical: 22,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  widget: {
    backgroundColor: colors.wall,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 5,
    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: {
    ...typography.label,
    color: colors.mu,
    fontSize: 9,
    letterSpacing: 1.4,
  },
  paper: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#f5df9a',
    borderRadius: 2,
    paddingHorizontal: 11,
    paddingVertical: 8,
    minHeight: 66,
  },
  magnet: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 3,
    backgroundColor: colors.acDecorative,
    boxShadow: '0 2px 3px rgba(0,0,0,0.35)',
  },
  body: { flex: 1, gap: 2 },
  headline: {
    fontFamily: typography.noteTitle.fontFamily,
    fontSize: 16,
    lineHeight: 18,
    color: colors.ntx,
  },
  when: {
    ...typography.support,
    fontFamily: typography.support.fontFamily,
    fontSize: 10.5,
    lineHeight: 13,
    color: colors.ntx,
  },
  emptyBody: {
    ...typography.support,
    fontSize: 9.5,
    lineHeight: 12,
    color: colors.mu,
  },
  pending: {
    ...typography.support,
    fontSize: 8.5,
    lineHeight: 11,
    color: colors.mu,
  },
});
