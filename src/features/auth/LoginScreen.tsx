import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProduct } from '../../composition/ProductProvider.tsx';
import { colors, typography } from '../../ui/theme.ts';
import { fontFamily } from '../../ui/fonts.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { PrimaryAction } from '../../ui/PrimaryAction.tsx';
import { Action, Field, Message, useAction } from '../../ui/Controls.tsx';

export function LoginScreen() {
  const { state, client } = useProduct();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('');
  const [show, setShow] = useState(false);
  const { busy, error, run } = useAction();
  useEffect(() => { if (state.session) router.replace(returnTo?.startsWith('/') && !returnTo.startsWith('//') && returnTo !== '/login' ? returnTo as '/' : '/'); }, [state.session, returnTo]);
  return <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}><KeyboardAvoidingView style={styles.frame} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
      <View style={styles.brand}><Text style={styles.logo}>alarmaT.</Text><Text style={typography.support}>Tu piso, a tu ritmo.</Text></View>
      <View style={styles.formSide}>
      <Sheet style={styles.form}>
        <Text accessibilityRole="header" style={[typography.detailTitle, styles.title]}>{register ? 'Crea tu cuenta.' : 'Qué bien verte.'}</Text>
        {register ? <Field label="Tu nombre" value={name} onChangeText={setName} placeholder="Como te llaman en casa" autoComplete="name" maxLength={80} /> : null}
        <Field label="Correo electrónico" value={email} onChangeText={setEmail} placeholder="tu@correo.es" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" />
        <View style={styles.password}>
          <Field label="Contraseña" value={password} onChangeText={setPassword} placeholder="Tu contraseña" secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} autoComplete={register ? 'new-password' : 'current-password'} returnKeyType="done" style={{ paddingRight: 76 }} onSubmitEditing={() => { if (!busy && email.trim() && password && (!register || name.trim())) void run(() => client.signIn({ email: email.trim(), password, displayName: name.trim() }, register)); }} />
          <Action label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} onPress={() => setShow(!show)} style={styles.passwordToggle}>{show ? 'Ocultar' : 'Ver'}</Action>
        </View>
        {register ? <Text style={typography.support}>Usa al menos 10 caracteres.</Text> : null}
      </Sheet>
      <Message text={error ?? state.error} error />
      {state.cleanupPending ? <Action disabled={busy} onPress={() => void run(() => client.signOut())}>Reintentar cierre y limpiar avisos</Action> : null}
      <PrimaryAction style={{ marginTop: 0 }} label={busy ? 'Un momento…' : register ? 'Crear mi cuenta' : 'Entrar en casa →'} disabled={busy || state.cleanupPending || !email.trim() || !password || (register && !name.trim())} onPress={() => void run(() => client.signIn({ email: email.trim(), password, displayName: name.trim() }, register))} />
      <Action onPress={() => setRegister(!register)} disabled={busy} style={{ borderWidth: 0 }}>{register ? 'Ya tengo cuenta · Entrar' : '¿Es tu primera vez? Crea una cuenta'}</Action>
      <View style={{ borderTopWidth: 1, borderColor: colors.ln, paddingTop: 18, gap: 12 }}><Text style={typography.support}>¿Quieres echar un vistazo primero?</Text><Action onPress={() => void run(() => client.startDemo())} disabled={busy}>Abrir la casa de ejemplo →</Action><Text style={typography.support}>Una demostración sin registro ni alarmas reales.</Text></View>
    </View>
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.wall }, frame: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' },
  page: { flexGrow: 1, padding: 16, paddingBottom: 24, gap: 16 }, brand: { gap: 2 },
  logo: { fontFamily: fontFamily.display, fontSize: 32, color: colors.tx, letterSpacing: -1 },
  formSide: { width: '100%', gap: 12 }, form: { padding: 18, gap: 8 },
  title: { fontSize: 32, lineHeight: 38 }, password: { position: 'relative' },
  passwordToggle: { position: 'absolute', right: 0, bottom: 6, minWidth: 64, borderWidth: 0, paddingHorizontal: 8 },
});
