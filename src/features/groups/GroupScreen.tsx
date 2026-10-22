import { useState } from 'react';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { useProduct } from '../../composition/ProductProvider.tsx';
import { AppShell } from '../../ui/AppShell.tsx';
import { Action, Avatar, Field, Message, useAction } from '../../ui/Controls.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { Note } from '../../ui/Note.tsx';
import { PrimaryAction } from '../../ui/PrimaryAction.tsx';
import { colors, typography } from '../../ui/theme.ts';

export function GroupScreen({ invitation }: { invitation?: string }) {
  const { state, client, group } = useProduct();
  const [name, setName] = useState(''); const [zone, setZone] = useState('Europe/Madrid');
  const [token, setToken] = useState(invitation ?? ''); const [created, setCreated] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  return <AppShell title={group?.name ?? 'Tu piso'} eyebrow="UN ESPACIO PARA COMPARTIR">
    <Message text={error} error />
    {group ? <>
      <Sheet style={{ maxWidth: 680, padding: 26, gap: 20 }}><Text style={typography.noteTitle}>Las personas detrás de las notas.</Text><Text style={typography.support}>{group.timeZone} · horarios del piso</Text>
        {state.members.map(member => <View key={member.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, borderTopWidth: 1, borderColor: colors.noteLine, paddingTop: 16 }}><Avatar name={member.displayName} selected={member.userId === state.session?.userId} /><Text style={[typography.body, { flex: 1 }]}>{member.displayName}{member.userId === state.session?.userId ? ' · tú' : ''}</Text><Text style={typography.labelOnNote}>{member.role === 'owner' ? 'CREÓ EL PISO' : 'EN CASA'}</Text></View>)}
      </Sheet>
      <View style={{ maxWidth: 680, width: '100%' }}><PrimaryAction label={busy ? 'Preparando invitación…' : 'Invitar a alguien al piso'} disabled={busy} onPress={() => void run(async () => setCreated(await client.createInvitation()))} /></View>
      {created ? <Note index={3} label="INVITACIÓN PRIVADA" title="Una puerta abierta."><Text style={typography.body}>Comparte este código con la persona que quieras invitar. Tendrá que entrar con su propia cuenta.</Text><Text selectable style={[typography.body, { paddingVertical: 14 }]}>{created}</Text></Note> : null}
      {state.groups.length > 1 ? <View style={{ gap: 10 }}><Text style={typography.label}>TUS PISOS</Text>{state.groups.map(item => <Action key={item.id} disabled={busy} selected={item.id === group.id} onPress={() => void run(() => client.selectGroup(item.id))}>{item.name}</Action>)}</View> : null}
    </> : null}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 28 }}>
      <View style={{ flexGrow: 1, flexBasis: 300, maxWidth: 600, gap: 14 }}><Sheet style={{ padding: 24 }}><Text style={typography.noteTitle}>Crear un nuevo piso</Text><Field label="Nombre de la casa" value={name} onChangeText={setName} maxLength={80} placeholder="Casa del sol" /><Field label="Zona horaria" value={zone} onChangeText={setZone} autoCapitalize="none" hint="Todos veréis los horarios en esta zona." /></Sheet><PrimaryAction label="Crear piso" disabled={busy || !name.trim()} onPress={() => void run(async () => { await client.createGroup(name.trim(), zone.trim()); setName(''); })} /></View>
      <View style={{ flexGrow: 1, flexBasis: 300, maxWidth: 600, gap: 14 }}><Sheet style={{ padding: 24 }}><Text style={typography.noteTitle}>¿Te han invitado?</Text><Text style={typography.body}>Pega el código que te ha pasado un compañero.</Text><Field label="Código de invitación" value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} placeholder="Tu código" /></Sheet><PrimaryAction label="Unirme a este piso" disabled={busy || !token.trim()} onPress={() => void run(async () => { await client.joinGroup(token.trim()); setToken(''); router.replace('/'); })} /></View>
    </View>
  </AppShell>;
}
