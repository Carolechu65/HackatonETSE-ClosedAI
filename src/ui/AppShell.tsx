import { useEffect, type ReactNode } from 'react';
import { router, usePathname } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography, paper } from './theme.ts';
import { fontFamily } from './fonts.ts';
import { useProduct } from '../composition/ProductProvider.tsx';
import { Action, Message } from './Controls.tsx';
import { RetroTabBar } from './RetroTabBar.tsx';

const destinations = [{ path: '/', name: 'index' }, { path: '/expenses', name: 'gastos' }, { path: '/tasks', name: 'tareas' }, { path: '/group', name: 'piso' }] as const;
export function AppShell({ children, title, eyebrow = 'LA PUERTA DE LA NEVERA', action }: { children: ReactNode; title: string; eyebrow?: string; action?: ReactNode }) {
  const { state, group } = useProduct();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  useEffect(() => { if (state.ready && !state.session) router.replace({ pathname: '/login', params: { returnTo: path } }); }, [state.ready, state.session, path]);
  if (!state.ready || !state.session) return <View style={styles.loading}><ActivityIndicator color={colors.tx} /><Text style={typography.body}>Abriendo tu nevera…</Text></View>;
  return <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
    <KeyboardAvoidingView style={styles.main} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="link" accessibilityLabel="Ir al tablón" onPress={() => router.push('/')} style={styles.brandLink}>
          <Text style={styles.brand}>alarmaT<Text style={{ color: colors.acDecorative }}>.</Text></Text>
          <Text numberOfLines={1} style={typography.support}>{group?.name ?? 'Tu piso'}</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => router.push('/calendar')} style={styles.headerLink}><Text style={typography.support}>Calendario</Text></Pressable>
        <Pressable accessibilityRole="link" accessibilityLabel="Mi cuenta y permisos" onPress={() => router.push('/settings')} style={styles.headerLink}><Text style={typography.support}>Mi cuenta</Text></Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="link" accessibilityLabel="Ver estado de sincronización" onPress={() => router.push('/settings')} style={styles.sync}><View style={[styles.dot, { backgroundColor: state.error ? colors.ac : '#2f7d6d' }]} /><Text style={typography.support}>{state.session.mode === 'demo' ? 'Modo demostración' : state.syncing ? 'Sincronizando…' : state.error ? 'Revisar estado' : state.pending ? `${state.pending} por enviar` : state.lastSync ? 'Al día' : 'Sin sincronizar'}</Text></Pressable>
        {state.session.mode === 'demo' ? <View style={styles.demo}><Text style={typography.support}>Casa de ejemplo. Los cambios duran esta sesión y no activan avisos.</Text><Action onPress={() => router.push('/settings')}>Conectar mi cuenta →</Action></View> : null}
        <View style={styles.heading}><Text style={typography.label}>{eyebrow}</Text><Text accessibilityRole="header" style={[typography.screenTitle, { fontSize: 32, lineHeight: 38 }]}>{title}</Text>{action ? <View style={styles.headingAction}>{action}</View> : null}</View>
        <Message text={state.error} error />
        {children}
        <View style={styles.footer}><Text style={typography.support}>Cada aviso empieza con una propuesta.</Text><Text style={typography.label}>TÚ DECIDES.</Text></View>
      </ScrollView>
      <RetroTabBar
        state={{ index: destinations.findIndex(item => item.path === path), routes: destinations.map(item => ({ key: item.path, name: item.name })) }}
        descriptors={{}}
        emitter={{ emit: () => ({ defaultPrevented: false }) }}
        navigateToTab={route => router.push(route as '/')}
        insets={{ bottom: insets.bottom }}
      />
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
export function BackLink({ to = '/', label = 'Volver al tablón' }: { to?: '/' | '/alarms' | '/tasks' | '/group'; label?: string }) {
  return <Action onPress={() => router.push(to)} style={{ alignSelf: 'flex-start', borderWidth: 0, paddingHorizontal: 0 }}>← {label}</Action>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: colors.wall },
  main: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', minWidth: 0 },
  topbar: { paddingHorizontal: 16, minHeight: 76, borderBottomWidth: 1, borderColor: colors.ln, flexDirection: 'row', alignItems: 'center', gap: 4 },
  brandLink: { flex: 1, minWidth: 0, minHeight: 48, justifyContent: 'center', paddingRight: 8 }, brand: { fontFamily: fontFamily.display, fontSize: 28, color: colors.tx, letterSpacing: -1 },
  headerLink: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 },
  sync: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, alignSelf: 'flex-start', marginBottom: -12, marginTop: -12 }, dot: { width: 6, height: 6, borderRadius: 3 },
  content: { padding: 18, paddingTop: 12, gap: 20, flexGrow: 1 },
  demo: { gap: 8, padding: 12, backgroundColor: paper[4], borderRadius: 2 }, heading: { gap: 8 }, headingAction: { marginTop: 6, width: '100%' },
  footer: { marginTop: 'auto', paddingTop: 20, gap: 8 },
});
