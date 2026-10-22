import { useEffect, type ReactNode } from 'react';
import { router, usePathname } from 'expo-router';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, paper } from './theme.ts';
import { fontFamily } from './fonts.ts';
import { useProduct } from '../composition/ProductProvider.tsx';
import { Action, Avatar, Message } from './Controls.tsx';

const brandLogo = require('../../assets/brand/alarmat-logo.png');
const destinations = [{ path: '/', label: 'Tablón', number: '01' }, { path: '/alarms', label: 'Alarmas', number: '02' }, { path: '/tasks', label: 'Tareas', number: '03' }, { path: '/group', label: 'Mi piso', number: '04' }] as const;
export function AppShell({ children, title, eyebrow = 'LA PUERTA DE LA NEVERA', action }: { children: ReactNode; title: string; eyebrow?: string; action?: ReactNode }) {
  const { state, group } = useProduct();
  const path = usePathname();
  const desktop = useWindowDimensions().width >= 1000;
  useEffect(() => { if (state.ready && !state.session) router.replace({ pathname: '/login', params: { returnTo: path } }); }, [state.ready, state.session, path]);
  if (!state.ready || !state.session) return <View style={styles.loading}><ActivityIndicator color={colors.tx} /><Text style={typography.body}>Abriendo tu nevera…</Text></View>;
  const links = destinations.map(item => {
    const active = path === item.path || (item.path !== '/' && path.startsWith(item.path.replace(/s$/, '')));
    return <Pressable key={item.path} accessibilityRole="link" accessibilityState={{ selected: active }} onPress={() => router.push(item.path)} style={[desktop ? styles.sideLink : styles.tab, active && styles.activeLink]}>
      {desktop ? <Text style={typography.label}>{item.number}</Text> : null}<Text style={[typography.tab, active && { color: colors.tx }]}>{item.label}</Text>
      {desktop && item.path === '/alarms' ? <Text style={typography.support}>{state.alarms.filter(a => a.recipients.some(r => r.uid === state.session?.userId && r.decision === 'PENDING')).length}</Text> : null}
    </Pressable>;
  });
  return <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
    {desktop ? <View style={styles.sidebar}>
      <Pressable accessibilityRole="link" accessibilityLabel="alarmaT, ir al tablón" onPress={() => router.push('/')} style={styles.brandLink}><Image source={brandLogo} style={styles.brandLogo} resizeMode="contain" /></Pressable>
      <View style={styles.groupBadge}><View style={styles.houseMark}><Text style={[typography.noteTitle, { fontSize: 26 }]}>aT</Text></View><View style={{ flex: 1, gap: 5 }}><Text style={typography.noteTitle}>{group?.name ?? 'Tu próximo piso'}</Text><Text style={typography.support}>{state.members.length} personas · tu espacio</Text></View></View>
      <View style={styles.sideNav}>{links}</View>
      <Pressable accessibilityRole="link" onPress={() => router.push('/assistant')} style={styles.assistantLink}><Text style={typography.label}>UN POCO DE AYUDA</Text><Text style={typography.noteTitle}>El compañero que recuerda.</Text><Text style={typography.support}>Prepara un aviso conversando →</Text></Pressable>
      <Action onPress={() => router.push('/calendar')}>Mi Google Calendar →</Action>
      <View style={{ flex: 1 }} />
      <Text style={[typography.support, { marginBottom: 20 }]}>Menos «se me olvidó».{`\n`}Más vida en común.</Text>
      <Pressable accessibilityRole="link" onPress={() => router.push('/settings')} style={styles.profile}><Avatar name={state.session.displayName} /><View style={{ gap: 3 }}><Text style={typography.body}>{state.session.displayName}</Text><Text style={typography.support}>Tu cuenta y permisos →</Text></View></Pressable>
    </View> : null}
    <View style={styles.main}>
      <View style={[styles.topbar, !desktop && { paddingHorizontal: 20 }]}>
        {desktop ? <Text style={typography.label}>TU CASA, A TU RITMO</Text> : <View style={styles.mobileBrand}><Image source={brandLogo} style={styles.mobileLogo} resizeMode="contain" accessibilityLabel="alarmaT" /><Text style={typography.support}>{group?.name ?? 'Tu piso'}</Text></View>}
        <Pressable accessibilityRole="link" onPress={() => router.push('/settings')} style={styles.sync}><View style={[styles.dot, { backgroundColor: state.error ? colors.ac : '#2f7d6d' }]} /><Text style={typography.support}>{state.session.mode === 'demo' ? 'Modo demostración' : state.syncing ? 'Sincronizando…' : state.error ? 'Revisar estado' : state.pending ? `${state.pending} por enviar` : state.lastSync ? 'Al día' : 'Sin sincronizar'}</Text></Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, !desktop && styles.mobileContent]}>
        {state.session.mode === 'demo' ? <View style={styles.demo}><Text style={[typography.support, { flex: 1 }]}>Estás en una casa de ejemplo. Los cambios duran esta sesión y no activan avisos.</Text><Pressable accessibilityRole="link" onPress={() => router.push('/settings')}><Text style={typography.support}>Conectar →</Text></Pressable></View> : null}
        <View style={styles.heading}><View style={{ flex: 1, gap: 10 }}><Text style={typography.label}>{eyebrow}</Text><Text accessibilityRole="header" style={[typography.screenTitle, !desktop && { fontSize: 46, lineHeight: 52 }]}>{title}</Text></View>{action}</View>
        <Message text={state.error} error />
        {children}
        <View style={styles.footer}><Text style={typography.support}>Cada aviso empieza con una propuesta.</Text><Text style={typography.label}>TÚ DECIDES.</Text></View>
      </ScrollView>
      {!desktop ? <View style={styles.tabs}>{links}</View> : null}
    </View>
  </SafeAreaView>;
}
export function BackLink({ to = '/', label = 'Volver al tablón' }: { to?: '/' | '/alarms' | '/tasks' | '/group'; label?: string }) {
  return <Action onPress={() => router.push(to)} style={{ alignSelf: 'flex-start', borderWidth: 0, paddingHorizontal: 0 }}>← {label}</Action>;
}
const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.wall }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: colors.wall },
  sidebar: { width: 260, borderRightWidth: 1, borderRightColor: colors.ln, paddingHorizontal: 28, paddingTop: 32, paddingBottom: 24, backgroundColor: '#e8dabb' },
  brandLink: { marginBottom: 6 },
  brandLogo: { width: 190, height: 57 },
  mobileBrand: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  mobileLogo: { width: 104, height: 31 },
  groupBadge: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 28, marginTop: 24, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.ln },
  houseMark: { width: 42, height: 45, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.ln },
  sideNav: { marginVertical: 28, gap: 8 }, sideLink: { flexDirection: 'row', minHeight: 52, alignItems: 'center', gap: 18, paddingHorizontal: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeLink: { borderBottomColor: colors.acDecorative }, assistantLink: { gap: 12, paddingTop: 24, borderTopWidth: 1, borderColor: colors.ln },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderColor: colors.ln, paddingTop: 20 }, main: { flex: 1, minWidth: 0 },
  topbar: { minHeight: 70, paddingHorizontal: 42, borderBottomWidth: 1, borderColor: colors.ln, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sync: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }, dot: { width: 6, height: 6, borderRadius: 3 },
  content: { padding: 42, paddingTop: 24, gap: 26, width: '100%', maxWidth: 1320, alignSelf: 'center', flexGrow: 1 }, mobileContent: { padding: 20, paddingTop: 18, gap: 22 },
  demo: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, backgroundColor: paper[4], borderRadius: 2 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap', paddingTop: 8, marginBottom: 4 },
  tabs: { borderTopWidth: 1, borderColor: colors.ln, flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 8 }, tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' }, footer: { marginTop: 'auto', paddingTop: 30, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
});
