import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useProduct } from '../../composition/ProductProvider.tsx';
import { AppShell } from '../../ui/AppShell.tsx';
import { Action, Field, Message, useAction } from '../../ui/Controls.tsx';
import { Note } from '../../ui/Note.tsx';
import { typography } from '../../ui/theme.ts';
import { router, useFocusEffect } from 'expo-router';
import type { AiProviderId, AiStatus } from './types.ts';

export function AiSettingsScreen() {
  const { state } = useProduct();
  return <ConnectionForm key={state.session?.userId ?? 'signed-out'} />;
}
function ConnectionForm() {
  const { state, client } = useProduct(); const action = useAction();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [provider, setProvider] = useState<AiProviderId>('openai'); const [model, setModel] = useState('gpt-6-luna');
  const [apiKey, setApiKey] = useState(''); const [ticket, setTicket] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null); const [confirmDelete, setConfirmDelete] = useState(false);
  const live = state.session?.mode === 'live';
  const focusEpoch = useRef(0);
  useFocusEffect(useCallback(() => {
    const epoch = ++focusEpoch.current;
    setApiKey(''); setTicket(null); setStatus(null); setMessage(null); setConfirmDelete(false); action.setError(null);
    if (live) void client.ai.status().then(value => {
      if (focusEpoch.current !== epoch) return;
      setStatus(value);
      if (value.connection) { setProvider(value.connection.provider); setModel(value.connection.model); }
    }).catch(error => {
      if (focusEpoch.current === epoch) action.setError(error instanceof Error ? error.message : 'No se pudo cargar tu conexión.');
    });
    // Expo keeps stack screens mounted. Clear secrets on blur, not only unmount.
    return () => { ++focusEpoch.current; setApiKey(''); setTicket(null); setConfirmDelete(false); };
  }, [client, live]));
  const run = (task: (current: () => boolean) => Promise<void>) => {
    const epoch = focusEpoch.current;
    void action.run(async () => {
      try { await task(() => focusEpoch.current === epoch); }
      catch (error) { if (focusEpoch.current === epoch) throw error; }
    });
  };
  const changed = () => { setTicket(null); setMessage(null); setConfirmDelete(false); };
  const enabled = live && !!status?.available && !action.busy;
  const input = { provider, model: model.trim(), apiKey: apiKey.trim() };
  return <AppShell title="Conectar mi IA" eyebrow="TU CUENTA, TU ASISTENTE">
    <View style={{ width: '100%', maxWidth: 700, gap: 24 }}>
      <Action onPress={() => router.replace('/settings')}>← Volver a ajustes</Action>
      <Text style={typography.bodyOnDoor}>Usa una clave de tu proveedor. El consumo del asistente y de la prueba se carga a esa cuenta, según sus tarifas y saldo.</Text>
      {!live ? <Message text="Inicia sesión con tu cuenta para conectar tu IA." /> : null}
      {status && !status.available ? <Message text="Las conexiones de IA no están disponibles ahora. Puedes crear alarmas manualmente." error /> : null}
      {status?.connection ? <Note index={1} label="CONEXIÓN GUARDADA" title={status.providers.find(p => p.id === status.connection?.provider)?.name ?? status.connection.provider} style={{ padding: 24, gap: 12 }}>
        <Text style={typography.body}>{status.connection.model}</Text><Text style={typography.body}>Clave {status.connection.maskedKey}</Text>
        <Text style={typography.support}>Verificada el {new Date(status.connection.verifiedAt).toLocaleDateString('es-ES')}. Puedes sustituirla probando y guardando una nueva.</Text>
        <Action disabled={action.busy} onPress={() => setConfirmDelete(true)}>Eliminar conexión</Action>
        {confirmDelete ? <View style={{ gap: 12 }}><Text style={typography.body}>El asistente dejará de usar esta conexión. Podrás seguir creando y aceptando alarmas.</Text><Action disabled={action.busy} onPress={() => run(async current => { const value = await client.ai.remove(); if (!current()) return; setStatus(value); setApiKey(''); changed(); setMessage('Conexión eliminada.'); })}>Eliminar conexión definitivamente</Action><Action disabled={action.busy} onPress={() => setConfirmDelete(false)}>Conservar conexión</Action></View> : null}
      </Note> : null}
      <Note index={3} label="ELIGE TU PROVEEDOR" title={status?.connection ? 'Sustituir mi conexión' : 'Tu asistente, a tu manera.'} style={{ padding: 24, gap: 16 }}>
        {status?.providers.map(p => <Action key={p.id} disabled={!enabled} selected={provider === p.id} onPress={() => { setProvider(p.id); setModel(p.models[0] ?? ''); changed(); }}>{p.name}</Action>)}
        <Field label="Modelo" value={model} onChangeText={v => { setModel(v); changed(); }} editable={enabled} autoCapitalize="none" autoCorrect={false} maxLength={160} hint="Usa el identificador de un modelo disponible en tu cuenta. La prueba comprueba su compatibilidad." />
        <Field label="API key del proveedor" value={apiKey} onChangeText={v => { setApiKey(v); changed(); }} editable={enabled} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" maxLength={2048} placeholder="Pega aquí tu clave" />
        <Text style={typography.support}>La prueba envía una petición pequeña y puede tener un coste. No envía datos de tu piso. Guardar después no vuelve a llamar al proveedor.</Text>
        <Action disabled={!enabled || !input.apiKey || !input.model} onPress={() => run(async current => { setTicket(null); setMessage(null); const result = await client.ai.test(input); if (!current()) return; setTicket(result.testToken); setMessage(result.message); })}>{action.busy ? 'Comprobando…' : 'Probar conexión'}</Action>
        <Action disabled={!enabled || !ticket} onPress={() => run(async current => { const proof = ticket!; setTicket(null); const result = await client.ai.save(input, proof); if (!current()) return; setStatus(result); setApiKey(''); setMessage('Conexión guardada. Ya puedes usar el asistente.'); })}>Guardar conexión</Action>
      </Note>
      <Message text={message} /><Message text={action.error} error />
      {!status && live ? <Action disabled={action.busy} onPress={() => run(async current => { const value = await client.ai.status(); if (current()) setStatus(value); })}>Volver a cargar conexión</Action> : null}
      <Text style={typography.support}>La clave se guarda cifrada y solo se usa para tus consultas. Nunca se utiliza la de otro usuario. Al usar el asistente, tu proveedor recibe tu petición y el contexto autorizado de tu piso necesario para preparar la propuesta.</Text>
      <Text style={typography.support}>Quien recibe una alarma no necesita conectar una IA. La API key da acceso al modelo; no conecta herramientas ni memoria de un agente personalizado.</Text>
      <Action onPress={() => router.push('/assistant')}>Abrir asistente</Action>
      <Action onPress={() => router.push('/alarm/new')}>Crear una alarma manualmente</Action>
    </View>
  </AppShell>;
}
