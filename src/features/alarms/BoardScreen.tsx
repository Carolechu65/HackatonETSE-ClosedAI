import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useProduct } from '../../composition/ProductProvider.tsx';
import { alarmStatus, currentRecipient, type ProductAlarm } from '../../composition/product.ts';
import { AppShell } from '../../ui/AppShell.tsx';
import { Action, Avatar, Message, useAction } from '../../ui/Controls.tsx';
import { Note } from '../../ui/Note.tsx';
import { PrimaryAction } from '../../ui/PrimaryAction.tsx';
import { colors, typography } from '../../ui/theme.ts';
import { formatDateTimeInZone } from '../../domain/time.ts';

export function BoardScreen({ alarmsOnly = false }: { alarmsOnly?: boolean }) {
  const { state, client, group, memberName } = useProduct();
  const [filter, setFilter] = useState('Todo');
  const { error, busy, run } = useAction();
  const userId = state.session?.userId ?? '';
  const alarms = state.alarms.filter(alarm => alarm.groupId === state.groupId);
  const pending = alarms.filter(alarm => alarm.request.status === 'ACTIVE' && ['PENDING', 'NEEDS_REVIEW'].includes(currentRecipient(alarm, userId)?.decision ?? ''));
  const tasks = state.tasks.filter(task => task.groupId === state.groupId && task.status === 'pending');
  const filtered = alarms.filter(alarm => filter === 'Todo' || filter === 'Alarmas' || (filter === 'Por responder' && pending.includes(alarm)) || (filter === 'Enviadas' && alarm.request.creatorUid === userId));
  const filters = alarmsOnly ? ['Todo', 'Por responder', 'Enviadas'] : ['Todo', 'Alarmas', 'Tareas'];
  return <AppShell title={alarmsOnly ? 'Tus alarmas' : 'El tablón'} action={<PrimaryAction style={{ width: 'auto', marginTop: 0, paddingHorizontal: 24 }} label="+ Proponer aviso" onPress={() => router.push('/alarm/new')} />}>
    {!group ? <Note title="Todo empieza con un piso" label="BIENVENIDO" index={1}><Text style={typography.body}>Crea vuestro espacio o entra con la invitación de un compañero.</Text><PrimaryAction label="Crear o unirme a un piso" onPress={() => router.push('/group')} /></Note> : <>
      <View style={styles.subline}><Text style={typography.bodyOnDoor}>{alarmsOnly ? 'Cada propuesta, a tu manera.' : `Hola, ${state.session?.displayName}. Esto es lo que hay por casa.`}</Text><Action disabled={busy || state.syncing} onPress={() => void run(() => client.refresh())} style={{ borderWidth: 0 }}>↻ Actualizar</Action></View>
      {!alarmsOnly ? <Action onPress={() => router.push('/alarms')}>Ver todas las alarmas →</Action> : null}
      <View style={styles.filters}>{filters.map(label => <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: filter === label }} onPress={() => setFilter(label)} style={[styles.filter, filter === label && { borderBottomColor: colors.acDecorative }]}><Text style={filter === label ? typography.tabActive : typography.tab}>{label}</Text></Pressable>)}</View>
      <Message text={error} error />
      <View style={styles.columns}>
        <View style={{ width: '100%', minWidth: 0, gap: 24 }}>
          {!alarmsOnly && filter !== 'Alarmas' ? <Note index={0} label="LA CASA EN MARCHA" title="Un poquito entre todos." wide style={styles.largeNote}>
            <Text style={[typography.support, { marginBottom: 14 }]}>Las pequeñas cosas que hacen que el piso funcione.</Text>
            {tasks.length ? tasks.slice(0, 4).map(task => <Pressable key={task.id} accessibilityRole="link" onPress={() => router.push(`/task/${task.id}`)} style={styles.taskRow}><View style={styles.checkbox} /><Text style={[typography.body, { flex: 1 }]}>{task.title}</Text><Text style={typography.support}>{task.assigneeUid ? memberName(task.assigneeUid) : 'Sin asignar'}</Text></Pressable>) : <Text style={typography.body}>Nada pendiente. La nevera respira.</Text>}
            <Action onPress={() => router.push('/tasks')} style={{ alignSelf: 'flex-start', borderWidth: 0, paddingHorizontal: 0 }}>Ver las tareas del piso →</Action>
          </Note> : null}
          {filter !== 'Tareas' ? <View style={styles.grid}>{filtered.map((alarm, index) => <AlarmNote key={alarm.requestId} alarm={alarm} index={index + 1} userId={userId} author={memberName(alarm.request.creatorUid)} />)}</View> : null}
          {filter !== 'Tareas' && !filtered.length ? <Note index={1} label="SIN PRISAS" title="No hay avisos aquí."><Text style={typography.body}>Las nuevas propuestas aparecerán en este espacio. Puedes empezar con una para alguien de casa.</Text></Note> : null}
          {!alarmsOnly ? <Note index={5} label="UN COMPAÑERO MÁS" title="Dilo como lo dirías en casa." style={styles.largeNote}><Text style={typography.body}>«Recuérdale a Dani sacar la basura mañana». El asistente te ayuda a preparar la propuesta y pregunta si falta algo.</Text><Action onPress={() => router.push('/assistant')} style={{ alignSelf: 'flex-start', borderWidth: 0, paddingHorizontal: 0 }}>Hablar con el asistente →</Action></Note> : null}
        </View>
        <View style={styles.aside}>
          <Text style={typography.label}>UN VISTAZO A HOY</Text>
          <Note index={4} label="TU DECISIÓN IMPORTA" title={pending.length ? `${pending.length} por responder` : 'Todo respondido'} style={styles.largeNote}><Text style={typography.body}>{pending.length ? 'Hay alguien que quiere proponerte una hora. Tú tienes la última palabra.' : 'Por ahora no tienes propuestas esperando tu respuesta.'}</Text>{pending[0] ? <Action onPress={() => router.push(`/alarm/${pending[0]!.requestId}`)} style={{ borderWidth: 0, alignSelf: 'flex-start', paddingHorizontal: 0 }}>Revisar propuesta →</Action> : null}</Note>
          <View style={styles.household}><Text style={typography.label}>EN ESTA CASA</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{state.members.map(member => <View key={member.userId} style={{ alignItems: 'center', gap: 8 }}><Avatar name={member.displayName} selected={member.userId === userId} /><Text style={typography.support}>{member.userId === userId ? 'Tú' : member.displayName}</Text></View>)}</View><Text style={typography.support}>{group.timeZone} · cada cual, a su hora</Text></View>
          <View style={styles.legend}><Text style={typography.noteTitle}>Un recordatorio amable.</Text><Text style={typography.support}>Aceptar una propuesta y activar una alarma son pasos distintos. Siempre verás si falta un permiso o una confirmación.</Text></View>
        </View>
      </View>
    </>}
  </AppShell>;
}
function AlarmNote({ alarm, index, userId, author }: { alarm: ProductAlarm; index: number; userId: string; author: string }) {
  const status = alarmStatus(alarm, userId);
  const time = currentRecipient(alarm, userId)?.chosenTimeSpec ?? alarm.request.timeSpec;
  return <Pressable accessibilityRole="link" accessibilityLabel={`${alarm.request.title}. ${status.title}. Ver detalle`} onPress={() => router.push(`/alarm/${alarm.requestId}`)} style={styles.gridItem}>
    <Note index={index} label={`${alarm.request.mode === 'ALARM' ? 'ALARMA' : 'RECORDATORIO'} · ${author}`} title={alarm.request.title} style={{ minHeight: 220, padding: 20, gap: 14 }}>
      <Text style={[typography.amount, { fontSize: 34, lineHeight: 38 }]}>{time.localTime}</Text><Text style={typography.support}>{formatDateTimeInZone(time.effectiveAtEpochMs, time.timeZone)}{alarm.request.recurrence ? ' · semanal' : ''}</Text>
      <View style={styles.status}><Text style={typography.labelOnNote}>{status.title}</Text><Text style={typography.body}>↗</Text></View>
    </Note>
  </Pressable>;
}
const styles = StyleSheet.create({
  add: { backgroundColor: colors.ac, borderColor: colors.ac }, subline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, borderBottomWidth: 1, borderColor: colors.ln }, filter: { minHeight: 48, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent', paddingHorizontal: 2 },
  columns: { gap: 24 }, grid: { gap: 20 }, gridItem: { width: '100%', minWidth: 0 },
  largeNote: { padding: 24, gap: 12 }, taskRow: { minHeight: 48, borderTopWidth: 1, borderColor: colors.noteLine, flexDirection: 'row', alignItems: 'center', gap: 12 }, checkbox: { height: 13, width: 13, borderWidth: 1, borderColor: colors.ntx, borderRadius: 2 },
  aside: { width: '100%', gap: 24 }, household: { borderTopWidth: 1, borderColor: colors.ln, paddingTop: 24, gap: 18 }, legend: { borderTopWidth: 1, borderColor: colors.ln, paddingTop: 24, gap: 12 }, status: { marginTop: 'auto', paddingTop: 12, borderTopWidth: 1, borderColor: colors.noteLine, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
