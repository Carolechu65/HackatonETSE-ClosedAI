import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useProduct } from '../../composition/ProductProvider.tsx';
import { colors, typography, paper } from '../../ui/theme.ts';
import { fontFamily } from '../../ui/fonts.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { Note } from '../../ui/Note.tsx';
import { PrimaryAction } from '../../ui/PrimaryAction.tsx';
import { Action, Field, Message, useAction } from '../../ui/Controls.tsx';

export function LoginScreen() {
  const { state, client } = useProduct();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('');
  const [show, setShow] = useState(false);
  const { busy, error, run } = useAction();
  const desktop = useWindowDimensions().width >= 900;
  useEffect(() => { if (state.session) router.replace(returnTo?.startsWith('/') && !returnTo.startsWith('//') && returnTo !== '/login' ? returnTo as '/' : '/'); }, [state.session, returnTo]);
  return <ScrollView style={{ backgroundColor: colors.wall }} contentContainerStyle={[styles.page, desktop && { flexDirection: 'row' }]} keyboardShouldPersistTaps="handled">
    <View style={[styles.story, desktop && { width: '52%', minHeight: 760 }]}>
      <Text style={styles.logo}>alarmaT.</Text><Text style={typography.label}>LA VIDA, COMPARTIDA</Text>
      <View style={{ flex: 1, minHeight: desktop ? 70 : 22 }} />
      <Text accessibilityRole="header" style={[styles.title, !desktop && { fontSize: 44, lineHeight: 49 }]}>Una casa.{`\n`}Muchas cosas.{`\n`}Menos olvidos.</Text>
      <Text style={[typography.bodyOnDoor, styles.intro]}>Un lugar para los pequeños compromisos del piso. Propón un aviso, organiza las tareas y deja que cada persona decida su hora.</Text>
      {desktop ? <Note index={0} label="NOTA PARA TODOS" title="¿Te pongo una alarma?" style={{ marginTop: 36, maxWidth: 330, padding: 24 }}><Text style={typography.body}>Sí, a esa hora. O un poquito más tarde.{`\n`}Quien la recibe, decide.</Text></Note> : null}
      <View style={styles.steps}>{['01  Propón', '02  Decide', '03  Recuérdalo'].map(label => <Text key={label} style={[typography.label, styles.step]}>{label}</Text>)}</View>
    </View>
    <View style={[styles.formSide, desktop && { width: '48%' }]}><View style={{ width: '100%', maxWidth: 420, gap: 18 }}>
      <Text style={typography.label}>BIENVENIDO A TU NEVERA</Text>
      <Sheet style={{ padding: 28, gap: 18 }}>
        <Text accessibilityRole="header" style={[typography.detailTitle, { fontSize: 38, lineHeight: 44 }]}>{register ? 'Haz sitio en casa.' : 'Qué bien verte.'}</Text>
        <Text style={typography.body}>{register ? 'Crea tu cuenta y abre un piso compartido.' : 'Entra para ver qué hay pegado en tu nevera.'}</Text>
        {register ? <Field label="Tu nombre" value={name} onChangeText={setName} placeholder="Como te llaman en casa" autoComplete="name" maxLength={80} /> : null}
        <Field label="Correo electrónico" value={email} onChangeText={setEmail} placeholder="tu@correo.es" keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        <Field label="Contraseña" value={password} onChangeText={setPassword} placeholder="Tu contraseña" secureTextEntry={!show} autoComplete={register ? 'new-password' : 'current-password'} hint={register ? 'Usa al menos 10 caracteres.' : undefined} onSubmitEditing={() => { if (!busy) void run(() => client.signIn({ email: email.trim(), password, displayName: name.trim() }, register)); }} />
        <Action onPress={() => setShow(!show)} style={{ alignSelf: 'flex-end', borderWidth: 0 }}>{show ? 'Ocultar contraseña' : 'Mostrar contraseña'}</Action>
      </Sheet>
      <Message text={error} error />
      <PrimaryAction label={busy ? 'Un momento…' : register ? 'Crear mi cuenta' : 'Entrar en casa →'} disabled={busy || !email.trim() || !password || (register && !name.trim())} onPress={() => void run(() => client.signIn({ email: email.trim(), password, displayName: name.trim() }, register))} />
      <Action onPress={() => setRegister(!register)} disabled={busy} style={{ borderWidth: 0 }}>{register ? 'Ya tengo cuenta · Entrar' : '¿Es tu primera vez? Crea una cuenta'}</Action>
      <View style={{ borderTopWidth: 1, borderColor: colors.ln, paddingTop: 18, gap: 12 }}><Text style={typography.support}>¿Quieres echar un vistazo primero?</Text><Action onPress={() => void run(() => client.startDemo())} disabled={busy}>Abrir la casa de ejemplo →</Action><Text style={typography.support}>Una demostración sin registro ni alarmas reales.</Text></View>
    </View></View>
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { flexGrow: 1, minHeight: '100%' }, story: { backgroundColor: '#e8dabb', padding: 40 }, logo: { fontFamily: fontFamily.display, fontSize: 42, color: colors.tx, letterSpacing: -2, marginBottom: 8 },
  title: { fontFamily: fontFamily.display, fontSize: 66, lineHeight: 71, letterSpacing: -2, color: colors.tx }, intro: { maxWidth: 430, marginTop: 22, fontSize: 13, lineHeight: 23 }, formSide: { padding: 28, paddingVertical: 50, justifyContent: 'center', alignItems: 'center' },
  steps: { flexDirection: 'row', gap: 22, marginTop: 56 }, step: { borderTopWidth: 1, borderTopColor: colors.ln, paddingTop: 16, flex: 1 },
});
