import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryAction, Screen, ScreenHeader, Sheet, colors, layout, typography } from '../src/ui/index.ts';
import { WidgetPreview, type WidgetVariant } from '../src/widgets/WidgetPreview.tsx';
import {
  WIDGET_DEMO_STATES,
  createDemoWidgetSnapshot,
  demoSessionFor,
  type WidgetDemoState,
} from '../src/widgets/demoSnapshot.ts';
import { clearWidget, reloadWidget, syncWidgetForSession } from '../src/widgets/publish.ts';
import { toWidgetProps } from '../src/widgets/viewModel.ts';

const TIME_ZONE = 'Europe/Madrid';

/**
 * `/widget-lab` · banco de pruebas del widget (P6).
 *
 * - En web: simulación visual con las funciones puras reales; publicar devuelve
 *   «no disponible» y se dice tal cual.
 * - En development build Android: los botones publican el snapshot en el widget
 *   instalado (`updateSnapshot`), lo vacían o fuerzan una recarga. Para verlo,
 *   añade el widget AlarmaT al launcher (mantener pulsado → Widgets).
 *
 * Los datos son de demostración; no hay sesión ni alarmas reales.
 */
export default function WidgetLabRoute() {
  const router = useRouter();
  const [variant, setVariant] = useState<WidgetVariant>('board');
  const [state, setState] = useState<WidgetDemoState>('next');
  const [now, setNow] = useState(() => Date.now());
  const [result, setResult] = useState<string | null>(null);

  const snapshot = useMemo(() => createDemoWidgetSnapshot(state, now), [state, now]);
  const props = useMemo(() => toWidgetProps(snapshot, now, { timeZone: TIME_ZONE }), [snapshot, now]);

  function select(next: WidgetDemoState): void {
    setState(next);
    setNow(Date.now());
    setResult(null);
  }

  function describe(published: boolean, reason?: string): string {
    if (published) return 'Publicado en los tres widgets instalados. Mira el launcher (puede tardar unos segundos).';
    if (reason === 'unsupported_platform') {
      return 'Sin widget nativo en esta plataforma: en web o Expo Go solo se simula. Usa una development build Android.';
    }
    return 'El módulo del widget respondió con error. No se actualizó nada.';
  }

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: 'Widgets' }} />
      <ScreenHeader eyebrow="ALARMAT EN TU ESCRITORIO" title="Tres widgets, tu piso" />

      <Sheet>
        <Text style={typography.labelOnNote}>DATOS DE DEMOSTRACIÓN</Text>
        <Text style={typography.body}>
          Alarmas, tareas y un tablón que reúne ambas. Los colores son los mismos que en la app.
          Desliza las notas para ver todas las tareas; aquí se muestran datos de ejemplo.
        </Text>
      </Sheet>

      <View style={styles.tabs}>
        {WIDGET_DEMO_STATES.map((option) => (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            accessibilityState={{ selected: option.id === state }}
            onPress={() => select(option.id)}
            style={({ pressed }) => [
              styles.tab,
              option.id === state && styles.tabActive,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.tabText, option.id === state && styles.tabTextActive]}>
              {option.label.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.tabs}>
        {([{ id: 'board', label: 'Tablón' }, { id: 'alarms', label: 'Alarmas' }, { id: 'tasks', label: 'Tareas' }] as const).map((option) => (
          <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: variant === option.id }} onPress={() => setVariant(option.id)} style={[styles.tab, variant === option.id && styles.tabActive]}>
            <Text style={[styles.tabText, variant === option.id && styles.tabTextActive]}>{option.label.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      <WidgetPreview props={props} variant={variant} />

      <View style={styles.meta}>
        <MetaRow label="PRÓXIMA" value={props.headline} />
        <MetaRow label="CUÁNDO" value={props.when.length > 0 ? props.when : '—'} />
        <MetaRow label="PENDIENTES" value={props.pending} />
        <MetaRow label="ACTUALIZADO" value={props.updated} />
        <MetaRow label="ENLACE" value={props.alarmUrl ?? props.inboxUrl} />
        <MetaRow label="ESTADO" value={WIDGET_DEMO_STATES.find((option) => option.id === state)?.hint ?? ''} />
      </View>

      <PrimaryAction
        label="Publicar estos ejemplos en los tres widgets"
        onPress={() => {
          const outcome = syncWidgetForSession(snapshot, demoSessionFor(state), now, { timeZone: TIME_ZONE });
          setResult(describe(outcome.published, outcome.published ? undefined : outcome.reason));
        }}
      />

      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setResult(describe(clearWidget(now).published))}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryText}>Vaciar widgets</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setResult(describe(reloadWidget().published))}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        >
          <Text style={styles.secondaryText}>Recargar</Text>
        </Pressable>
      </View>

      <Text accessibilityLiveRegion="polite" style={styles.result}>
        {result ?? 'Sin publicar todavía. El widget instalado conserva su último snapshot.'}
      </Text>

      <Text style={typography.support}>
        En Android: mantén pulsado el escritorio → Widgets → AlarmaT y elige Tablón, Alarmas o Tareas.
        Puedes ampliar su tamaño o deslizar su contenido. Necesitas la última versión de la app.
        Publicar estos ejemplos reemplaza temporalmente el contenido de tus widgets; no crea tareas ni alarmas.
      </Text>

      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
        <Text style={typography.label}>← VOLVER</Text>
      </Pressable>
    </Screen>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.ln,
    borderRadius: 2,
  },
  tabActive: { backgroundColor: colors.tx, borderColor: colors.tx },
  tabText: { ...typography.label, color: colors.mu, fontSize: 9 },
  tabTextActive: { color: colors.wall },
  pressed: { opacity: 0.85 },
  meta: { gap: 6, paddingHorizontal: 2 },
  metaRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  metaLabel: { ...typography.label, color: colors.mu, width: 96, fontSize: 8.5 },
  metaValue: { ...typography.body, flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
  secondary: {
    flex: 1,
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.ln,
    borderRadius: layout.radius,
  },
  secondaryText: { ...typography.tab, color: colors.tx },
  result: { ...typography.support, color: colors.mu },
  back: { alignSelf: 'flex-start', minHeight: layout.minTouchTarget, justifyContent: 'center' },
});
