import { useState } from 'react';
import { router } from 'expo-router';
import { Platform, Text, View } from 'react-native';
import { useProduct } from '../../composition/ProductProvider.tsx';
import { AppShell } from '../../ui/AppShell.tsx';
import { Action, Message, useAction } from '../../ui/Controls.tsx';
import { Note } from '../../ui/Note.tsx';
import { PrimaryAction } from '../../ui/PrimaryAction.tsx';
import { typography } from '../../ui/theme.ts';

export function SettingsScreen() {
  const { state, client } = useProduct(); const { busy, error, run } = useAction(); const [message, setMessage] = useState<string | null>(null);
  return <AppShell title="A tu manera" eyebrow="TU CUENTA Y TUS AVISOS">
    <View style={{ maxWidth: 700, width: '100%', gap: 28 }}><Note index={1} label="TU CUENTA" title={state.session?.displayName ?? 'Tu cuenta'} style={{ padding: 24, gap: 16 }}><Text style={typography.body}>{state.session?.mode === 'demo' ? 'Estás probando una casa de ejemplo. No se envían propuestas ni se activan alarmas.' : 'Tus avisos solo se activan tras tu decisión y la confirmación del dispositivo.'}</Text><Action onPress={() => router.push('/group')}>Ver mi piso y compañeros</Action></Note>
      <Note index={3} label="PERMISOS DEL DISPOSITIVO" title="Que te avise como tú quieres." style={{ padding: 24, gap: 16 }}><Text style={typography.body}>En Android, las alarmas sonoras necesitan notificaciones y acceso a alarmas exactas. Solicítalos cuando quieras activar tu primer aviso.</Text><Action disabled={busy} onPress={() => void run(async () => setMessage(await client.requestPermissions()))}>Revisar permisos de los avisos</Action><Text style={typography.support}>La vista web permite proponer y responder. El sonido y el widget se activan en la app Android instalada.</Text></Note>
      <Note index={4} label="MÓVIL PRINCIPAL" title="Un solo móvil para tus alarmas." style={{ padding: 24, gap: 16 }}><Text style={typography.body}>Si has cambiado de teléfono, elige este para activar tus avisos. El anterior los retirará al volver a conectarse.</Text><Action disabled={busy} onPress={() => void run(async () => setMessage(await client.makePrimaryDevice()))}>Usar este móvil como principal</Action></Note>
      <Note index={2} label="WIDGET EN ANDROID" title="Tu nevera, a un toque." style={{ padding: 24, gap: 16 }}><Text style={typography.body}>Instala la app Android. Mantén pulsado un hueco en la pantalla de inicio, abre Widgets y busca AlarmaT. Arrástralo a la pantalla.</Text><Text style={typography.support}>Muestra el piso seleccionado en la app y la última sincronización. Toca el aviso para abrir su detalle y decidir; abrirlo no acepta una propuesta. Actualiza la app para recibir cambios de otros miembros.</Text><Text style={typography.support}>El navegador y Expo Go no instalan el widget. Si todavía no aparece en el selector del móvil, comprueba que instalaste la versión Android que lo incluye.</Text></Note>
      {Platform.OS === 'web' ? <Text style={typography.support}>En el navegador, la sesión dura mientras esta pestaña siga abierta. Si recargas la página, tendrás que volver a entrar.</Text> : null}
      <Note index={4} label="TU AGENDA" title="Google Calendar" style={{ padding: 24, gap: 16 }}><Text style={typography.body}>Conecta tu calendario personal, consulta tus planes y guarda tus compromisos.</Text><Action onPress={() => router.push('/calendar')}>Abrir mi calendario</Action></Note>
      <Message text={message} /><Message text={error} error />
      <PrimaryAction disabled={busy} label={busy ? 'Cerrando…' : state.session?.mode === 'demo' ? 'Salir de la demo y conectar mi cuenta' : 'Cerrar mi sesión'} onPress={() => void run(async () => { await client.signOut(); router.replace('/login'); })} />
      <Text style={typography.support}>Al cerrar sesión se cancelan los avisos locales de tu cuenta y se retira la información privada del widget.</Text>
    </View>
  </AppShell>;
}
