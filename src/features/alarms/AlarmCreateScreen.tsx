import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useProduct } from '../../composition/ProductProvider.tsx';
import type { CreateAlarmRequestPayload } from '../../domain/contracts/types.ts';
import { formatDateTimeInZone, wallClockInZone } from '../../domain/time.ts';
import { AppShell, BackLink } from '../../ui/AppShell.tsx';
import { Action, Choice, Field, Message, useAction } from '../../ui/Controls.tsx';
import { Sheet, PrimaryAction, typography } from '../../ui/index.ts';
import { alarmPayload, createSubmissionIds, type AlarmForm } from './form.ts';

export function AlarmCreateScreen({ initialDraft, initialTaskId, onCancel }: { initialDraft?: CreateAlarmRequestPayload; initialTaskId?: string; onCancel?: () => void } = {}) {
  const { state, client, group } = useProduct();
  const [form, setForm] = useState<AlarmForm>(() => {
    const task = state.tasks.find(item => item.id === initialTaskId && item.groupId === state.groupId && item.status === 'pending');
    const clock = initialDraft?.timeSpec ?? wallClockInZone(Date.now() + 3_600_000, group?.timeZone ?? 'Europe/Madrid');
    return { title: initialDraft?.title ?? task?.title ?? '', note: initialDraft?.note ?? '', recipientUids: initialDraft?.recipientUids ?? [],
      localDate: clock.localDate, localTime: clock.localTime, timeZone: initialDraft?.timeSpec.timeZone ?? group?.timeZone ?? 'Europe/Madrid',
      mode: initialDraft?.mode ?? 'ALARM', weekly: !!initialDraft?.recurrence, taskId: initialDraft?.taskId ?? initialTaskId ?? '', untilEpochMs: initialDraft?.recurrence?.untilEpochMs };
  });
  const operationId = useRef(createSubmissionIds());
  const locked = useRef(false);
  const action = useAction();
  const [sent, setSent] = useState(false);
  const update = <K extends keyof AlarmForm>(key: K, value: AlarmForm[K]) => setForm(previous => ({ ...previous, [key]: value }));
  const tasks = state.tasks.filter(task => task.groupId === state.groupId && task.status === 'pending');
  const recipients = state.members;
  const context = { groupId: state.groupId ?? '', memberIds: recipients.map(m => m.userId), actorUid: state.session?.userId, openTaskIds: tasks.map(t => t.id), nowEpochMs: Date.now() };
  let preview: CreateAlarmRequestPayload | null = null;
  try { preview = alarmPayload(form, context); } catch { /* Errors appear on explicit submission, not before typing. */ }
  const submit = () => {
    if (locked.current || sent) return;
    locked.current = true;
    void action.run(async () => {
      if (!state.groupId) throw new Error('Crea un piso o únete a uno antes de proponer un aviso.');
      const payload = alarmPayload(form, { ...context, nowEpochMs: Date.now() });
      const id = await client.createAlarm(payload, operationId.current(`${state.session?.userId}:${state.groupId}`, payload));
      setSent(true);
      if (id) router.replace({ pathname: '/alarm/[requestId]', params: { requestId: id } });
    }).finally(() => { locked.current = false; });
  };
  return <AppShell title={initialDraft ? 'Revisa la propuesta.' : 'Que no se nos olvide.'} eyebrow={initialDraft ? 'BORRADOR DEL ASISTENTE' : 'NUEVO AVISO'}>
    <BackLink to="/alarms" label="Volver a alarmas" />
    <View style={styles.column}>
      <Text style={typography.bodyOnDoor}>Una propuesta para coordinaros. Cada persona elige si activa el aviso en su móvil.</Text>
      {sent ? <><Message text="Solicitud guardada. Consulta la bandeja para comprobar el envío y la decisión de cada destinatario. Guardarla no confirma la programación en sus móviles." /><Action onPress={() => router.replace('/alarms')}>Ver mis alarmas</Action></> : <>
      <Sheet>
        <Field label="¿Qué hay que recordar?" value={form.title} maxLength={120} onChangeText={v => update('title', v)} editable={!action.busy} placeholder="Sacar la basura" />
        <Field label="Una nota, si hace falta" value={form.note} maxLength={500} onChangeText={v => update('note', v)} multiline editable={!action.busy} placeholder="La recogida pasa a las nueve." />
        <Text style={typography.labelOnNote}>PARA QUIÉN</Text>
        <View style={styles.choices}>{recipients.map(member => <Choice key={member.userId} label={member.userId === state.session?.userId ? `${member.displayName} · Tú` : member.displayName} selected={form.recipientUids.includes(member.userId)} onPress={() => { if (!action.busy) update('recipientUids', form.recipientUids.includes(member.userId) ? form.recipientUids.filter(id => id !== member.userId) : [...form.recipientUids, member.userId]); }} />)}</View>
        {!recipients.length ? <><Text style={typography.support}>Crea un piso o únete a uno para configurar tus avisos.</Text><Action onPress={() => router.push('/group')}>Ir al piso →</Action></> : null}
        <View style={styles.fields}><View style={styles.grow}><Field label="Fecha · AAAA-MM-DD" value={form.localDate} onChangeText={v => update('localDate', v)} editable={!action.busy} placeholder="2026-10-24" autoCapitalize="none" /></View><View style={styles.grow}><Field label="Hora · HH:mm" value={form.localTime} onChangeText={v => update('localTime', v)} editable={!action.busy} placeholder="20:30" /></View></View>
        <Field label="Zona horaria" value={form.timeZone} onChangeText={v => update('timeZone', v)} editable={!action.busy} autoCapitalize="none" autoCorrect={false} hint="Ejemplo: Europe/Madrid. La vista previa muestra la hora resuelta, incluido el cambio de hora." />
        <Text style={typography.labelOnNote}>CÓMO AVISAR</Text>
        <View style={styles.choices}><Choice label="Alarma sonora" selected={form.mode === 'ALARM'} onPress={() => { if (!action.busy) update('mode', 'ALARM'); }} /><Choice label="Notificación" selected={form.mode === 'NOTIFICATION'} onPress={() => { if (!action.busy) update('mode', 'NOTIFICATION'); }} /></View>
        <Text style={typography.labelOnNote}>REPETICIÓN</Text>
        <View style={styles.choices}><Choice label="Solo esta vez" selected={!form.weekly} onPress={() => { if (!action.busy) update('weekly', false); }} /><Choice label="Cada semana" selected={form.weekly} onPress={() => { if (!action.busy) update('weekly', true); }} /></View>
        <Text style={typography.support}>{form.weekly ? 'Se repetirá el mismo día de la semana y a la misma hora local. Cada persona puede autorizar una ocasión o la serie.' : 'Un único aviso, a la hora que acuerdes.'}</Text>
        {form.weekly && form.untilEpochMs !== undefined ? <><Text style={typography.support}>La serie termina el {formatDateTimeInZone(form.untilEpochMs, initialDraft?.timeSpec.timeZone ?? group?.timeZone ?? 'Europe/Madrid')}. Revisa este límite del borrador.</Text><Action disabled={action.busy} onPress={() => update('untilEpochMs', undefined)}>Quitar fecha de fin</Action></> : null}
        <Text style={typography.labelOnNote}>TAREA ASOCIADA</Text>
        <View style={styles.choices}><Choice label="Aviso independiente" selected={!form.taskId} onPress={() => { if (!action.busy) update('taskId', ''); }} />{tasks.map(task => <Choice key={task.id} label={task.title} selected={form.taskId === task.id} onPress={() => { if (!action.busy) update('taskId', task.id); }} />)}</View>
        {form.taskId && form.mode === 'ALARM' ? <Text style={typography.support}>En la app Android actualizada, esta alarma vuelve a avisar a los 10 minutos mientras la tarea siga pendiente. Detenerla no completa la tarea.</Text> : null}
      </Sheet>
      {preview ? <Message text={`${preview.title} · ${formatDateTimeInZone(preview.timeSpec.effectiveAtEpochMs, preview.timeSpec.timeZone)} (${preview.timeSpec.timeZone}) · ${preview.recipientUids.length} persona${preview.recipientUids.length === 1 ? '' : 's'}${preview.recurrence ? ' · cada semana' : ''}.`} /> : null}
      <Message text={action.error} error />
      <PrimaryAction label={action.busy ? 'Enviando propuesta…' : 'Enviar propuesta'} disabled={action.busy || !state.groupId || !recipients.length} onPress={submit} />
      {onCancel ? <Action disabled={action.busy} onPress={onCancel}>Volver a la conversación</Action> : null}
      </>}
    </View>
  </AppShell>;
}
const styles = StyleSheet.create({ column: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: 18 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, fields: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 }, grow: { flex: 1, minWidth: 170 } });
