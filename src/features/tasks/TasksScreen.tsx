import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useProduct } from '../../composition/ProductProvider.tsx';
import { AppShell, BackLink } from '../../ui/AppShell.tsx';
import { Action, Choice, Field, Message, useAction } from '../../ui/Controls.tsx';
import { Note } from '../../ui/Note.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { PrimaryAction } from '../../ui/PrimaryAction.tsx';
import { colors, typography } from '../../ui/theme.ts';
import { createTimeSpec, formatDateTimeInZone } from '../../domain/time.ts';
import { createIdGenerator } from '../../domain/ids.ts';
import { describeTaskDue } from './model.ts';
const ids = createIdGenerator();

export function TasksScreen() {
  const { state, memberName, group } = useProduct(); const [mine, setMine] = useState(false);
  const tasks = state.tasks.filter(task => task.groupId === state.groupId && (!mine || task.assigneeUid === state.session?.userId));
  return <AppShell title="Pequeñas tareas" eyebrow="ENTRE TODOS, SE HACE MÁS FÁCIL" action={<Action onPress={() => router.push('/task/new')}>+ Añadir tarea</Action>}>
    <View style={{ flexDirection: 'row', gap: 12 }}><Choice label="Todo el piso" selected={!mine} onPress={() => setMine(false)} /><Choice label="Las mías" selected={mine} onPress={() => setMine(true)} /></View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24 }}>{tasks.map((task, index) => <Pressable key={task.id} accessibilityRole="link" onPress={() => router.push(`/task/${task.id}`)} style={{ flexBasis: 270, flexGrow: 1, maxWidth: 500 }}><Note index={index} label={task.status === 'completed' ? 'HECHO · GRACIAS' : task.status === 'cancelled' ? 'CANCELADA' : 'POR HACER'} title={task.title} style={{ padding: 24, minHeight: 180, gap: 18 }}><Text style={typography.body}>{task.assigneeUid ? memberName(task.assigneeUid) : 'Sin asignar'}</Text><Text style={typography.support}>{describeTaskDue(task, Date.now(), group?.timeZone ?? 'Europe/Madrid')}</Text><Text style={typography.support}>Ver tarea →</Text></Note></Pressable>)}</View>
    {!tasks.length ? <Note title="Nada pendiente por aquí." index={1}><Text style={typography.body}>Añade una tarea y elegid quién se ocupa. Un recordatorio se propone por separado.</Text></Note> : null}
  </AppShell>;
}
export function TaskCreateScreen() {
  const { state, client, group } = useProduct();
  const [title, setTitle] = useState(''); const [assignee, setAssignee] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState(''); const [dueTime, setDueTime] = useState('');
  const [activeDate, setActiveDate] = useState(''); const [activeTime, setActiveTime] = useState('');
  const { busy, error, run } = useAction(); const operation = useRef<{ key: string; id: string } | null>(null);
  const create = async () => {
    if (!group) throw new Error('Crea o selecciona un piso primero.');
    if (!!dueDate !== !!dueTime || !!activeDate !== !!activeTime) throw new Error('Completa la fecha y la hora, o deja ambos campos vacíos.');
    const draft = { title: title.trim(), assigneeUid: assignee, dueAtEpochMs: dueDate ? createTimeSpec({ localDate: dueDate, localTime: dueTime, timeZone: group.timeZone }).effectiveAtEpochMs : null, activateAtEpochMs: activeDate ? createTimeSpec({ localDate: activeDate, localTime: activeTime, timeZone: group.timeZone }).effectiveAtEpochMs : null };
    const key = JSON.stringify({ groupId: group.id, draft }); if (operation.current?.key !== key) operation.current = { key, id: ids.next('op') };
    const id = await client.createTask(draft, operation.current.id); router.replace(`/task/${id}`);
  };
  return <AppShell title="Una cosa por hacer" eyebrow="NUEVA TAREA"><BackLink to="/tasks" label="Volver a tareas" />
    <View style={{ width: '100%', maxWidth: 700, gap: 18 }}><Sheet style={{ padding: 26, gap: 20 }}>
      <Field label="Qué hay que hacer" value={title} onChangeText={setTitle} maxLength={120} placeholder="Dejar la cocina a punto" />
      <Text style={typography.labelOnNote}>QUIÉN SE OCUPA</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}><Choice label="Sin asignar" selected={assignee === null} onPress={() => setAssignee(null)} />{state.members.map(member => <Choice key={member.userId} label={member.displayName} selected={assignee === member.userId} onPress={() => setAssignee(member.userId)} />)}</View>
      <Text style={typography.noteTitle}>¿Tiene una fecha?</Text><Text style={typography.support}>Opcional. La fecha límite es independiente de cualquier aviso. Zona: {group?.timeZone ?? 'la del piso'}.</Text>
      <Field label="Fecha límite (AAAA-MM-DD)" value={dueDate} onChangeText={setDueDate} placeholder="2026-10-25" /><Field label="Hora límite (HH:mm)" value={dueTime} onChangeText={setDueTime} placeholder="20:00" />
      <Field label="Se activa el (AAAA-MM-DD, opcional)" value={activeDate} onChangeText={setActiveDate} placeholder="2026-10-25" /><Field label="Hora de activación (HH:mm)" value={activeTime} onChangeText={setActiveTime} placeholder="09:00" />
    </Sheet><Message text={error} error /><PrimaryAction label={busy ? 'Guardando…' : 'Añadir tarea al piso'} disabled={busy || !title.trim() || !group} onPress={() => void run(create)} /></View>
  </AppShell>;
}
export function TaskProductDetail({ taskId }: { taskId: string }) {
  const { state, client, memberName, group } = useProduct(); const { busy, error, run } = useAction();
  const task = state.tasks.find(item => item.id === taskId && item.groupId === state.groupId); const operations = useRef<Record<string, string>>({});
  const update = async (status: 'completed' | 'cancelled') => { if (!task) return; const key = `${task.id}:${task.version}:${status}`; operations.current[key] ??= ids.next('op'); await client.updateTask(task, status, operations.current[key]); };
  return <AppShell title="La tarea" eyebrow="CADA COSA, A SU TIEMPO"><BackLink to="/tasks" label="Volver a tareas" />
    {!task ? <Note title="Esta nota no está disponible." index={4}><Text style={typography.body}>Puede pertenecer a otro piso o haberse retirado. Comprueba tu cuenta.</Text></Note> : <View style={{ maxWidth: 700, width: '100%', gap: 18 }}>
      <Sheet style={{ padding: 28, gap: 24 }}><Text style={typography.labelOnNote}>{task.status === 'completed' ? 'COMPLETADA' : task.status === 'cancelled' ? 'CANCELADA' : 'POR HACER'}</Text><Text style={[typography.detailTitle, { lineHeight: 50 }]}>{task.title}</Text><Text style={typography.body}>Se ocupa: {task.assigneeUid ? memberName(task.assigneeUid) : 'Todavía por decidir'}</Text><Text style={typography.body}>{describeTaskDue(task, Date.now(), group?.timeZone ?? 'Europe/Madrid')}</Text>{task.activateAtEpochMs ? <Text style={typography.support}>Activación: {formatDateTimeInZone(task.activateAtEpochMs, group?.timeZone ?? 'Europe/Madrid')}</Text> : null}
        <Text style={typography.support}>{task.status === 'pending' ? 'Detener o posponer una alarma no completa esta tarea.' : 'Los avisos vinculados se retiran cuando cada dispositivo recibe el cambio.'}</Text>
      </Sheet><Message text={error} error />
      {task.status === 'pending' ? <><PrimaryAction label={busy ? 'Guardando…' : 'Marcar como hecha'} disabled={busy} onPress={() => void run(() => update('completed'))} /><Action disabled={busy} onPress={() => router.push({ pathname: '/alarm/new', params: { taskId: task.id } })}>Proponer un recordatorio para esta tarea</Action><Action disabled={busy} onPress={() => void run(() => update('cancelled'))}>Cancelar tarea</Action></> : null}
    </View>}
  </AppShell>;
}
