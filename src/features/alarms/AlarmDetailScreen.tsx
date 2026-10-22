import { taskCanChangeCompletion } from '../tasks/model.ts';
import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useProduct } from '../../composition/ProductProvider.tsx';
import { alarmStatus, currentRecipient, recipientAlarmStatus } from '../../composition/product.ts';
import { createTimeSpec, formatDateTimeInZone } from '../../domain/time.ts';
import type { ConsentScope } from '../../domain/states.ts';
import type { RespondToAlarmPayload } from '../../domain/contracts/types.ts';
import { AppShell, BackLink } from '../../ui/AppShell.tsx';
import { Action, Choice, Field, Message, useAction } from '../../ui/Controls.tsx';
import { Sheet, PrimaryAction, typography } from '../../ui/index.ts';
import { createSubmissionIds, responsePayload } from './form.ts';

export function AlarmDetailScreen({ requestId }: { requestId: string }) {
  const { state, client, memberName } = useProduct();
  const alarm = state.alarms.find(item => item.requestId === requestId && item.groupId === state.groupId);
  const recipient = alarm && state.session ? currentRecipient(alarm, state.session.userId) : undefined;
  const [consentScope, setConsentScope] = useState<ConsentScope>('THIS_OCCURRENCE');
  const [changing, setChanging] = useState(false);
  const [chosen, setChosen] = useState({ localDate: '', localTime: '', timeZone: '' });
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const ids = useRef(createSubmissionIds());
  const locked = useRef(false);
  const action = useAction();
  if (!alarm || !state.session) return <AppShell title="Este aviso no está disponible." eyebrow="ALARMAS"><BackLink to="/alarms" label="Volver a alarmas" /><Message text="Puede que el aviso no exista, pertenezca a otro piso o falte sincronizar." /><Action disabled={action.busy} onPress={() => void action.run(() => client.refresh())}>Volver a sincronizar</Action><Message text={action.error} error /></AppShell>;
  const request = alarm.request;
  const task = request.taskId ? state.tasks.find(item => item.id === request.taskId && item.groupId === alarm.groupId) : undefined;
  const status = alarmStatus(alarm, state.session.userId);
  const effective = recipient?.chosenTimeSpec ?? request.timeSpec;
  const versionKey = `${state.session.userId}:${alarm.groupId}:${requestId}:${request.requestVersion}:${recipient?.decisionRevision ?? 0}`;
  const needsReview = recipient?.decision === 'NEEDS_REVIEW' || alarm.sync === 'CONFLICT';
  const canRespond = !!recipient && request.status === 'ACTIVE' && (!needsReview || reviewed === versionKey);
  const canAccept = canRespond && effective.effectiveAtEpochMs > Date.now();
  const busy = action.busy || alarm.sync === 'QUEUED' || alarm.sync === 'SENDING';
  const startChanging = () => { setChosen({ localDate: effective.localDate, localTime: effective.localTime, timeZone: effective.timeZone }); setChanging(true); action.setError(null); setNotice(null); };
  const respond = (decision: RespondToAlarmPayload['decision'], differentTime = false) => {
    if (locked.current || busy || !canRespond || !recipient) return;
    locked.current = true;
    void action.run(async () => {
      if (decision === 'ACCEPTED' && !differentTime && effective.effectiveAtEpochMs <= Date.now()) throw new Error('La hora ya ha pasado. Elige otra hora antes de aceptar.');
      const payload = responsePayload({ groupId: alarm.groupId, requestId, requestVersion: request.requestVersion,
        decisionRevision: recipient.decisionRevision, decision, consentScope: request.recurrence ? consentScope : 'THIS_OCCURRENCE',
        ...(decision === 'ACCEPTED' ? { chosen: differentTime ? chosen : effective } : {}), nowEpochMs: Date.now() });
      await client.respond(alarm, payload, ids.current(versionKey, payload));
      setChanging(false);
      setNotice(decision === 'ACCEPTED' ? 'Has enviado tu aceptación. Consulta el estado para comprobar si el móvil pudo activar el aviso.' : decision === 'REJECTED' ? 'Has rechazado el aviso. La tarea asociada no cambia.' : 'Has solicitado desactivar tu aviso. La retirada puede seguir pendiente en el dispositivo.');
    }).finally(() => { locked.current = false; });
  };
  const withdraw = () => {
    if (locked.current || busy) return;
    locked.current = true;
    void action.run(async () => {
      await client.withdraw(alarm, ids.current(versionKey, { withdraw: true }));
      setConfirmWithdraw(false); setNotice('Retirada solicitada. Cada móvil la aplica cuando recibe y confirma el cambio.');
    }).finally(() => { locked.current = false; });
  };
  let chosenPreview: string | null = null;
  try { if (changing) chosenPreview = formatDateTimeInZone(createTimeSpec(chosen).effectiveAtEpochMs, chosen.timeZone); } catch { /* Validate on save. */ }
  return <AppShell title="Un aviso, a tu ritmo." eyebrow="PROPUESTA COMPARTIDA">
    <BackLink to="/alarms" label="Volver a alarmas" />
    <View style={styles.column}>
      <Sheet>
        <Text style={typography.labelOnNote}>DE {memberName(request.creatorUid).toUpperCase()} · VERSIÓN {request.requestVersion}</Text>
        <Text accessibilityRole="header" style={typography.detailTitle}>{request.title}</Text>
        {request.note ? <Text style={typography.body}>{request.note}</Text> : null}
        <Text style={typography.noteTitle}>{formatDateTimeInZone(effective.effectiveAtEpochMs, effective.timeZone)}</Text>
        <Text style={typography.support}>{effective.timeZone} · {request.mode === 'ALARM' ? 'Alarma sonora' : 'Notificación'}{request.recurrence ? ' · cada semana' : ''}</Text>
        {request.recurrence?.untilEpochMs ? <Text style={typography.support}>Hasta {formatDateTimeInZone(request.recurrence.untilEpochMs, effective.timeZone)}.</Text> : null}
        {recipient?.chosenTimeSpec ? <Text style={typography.support}>Hora propuesta originalmente: {formatDateTimeInZone(request.timeSpec.effectiveAtEpochMs, request.timeSpec.timeZone)}.</Text> : null}
        <Text style={typography.labelOnNote}>{status.title.toUpperCase()}</Text>
        <Text style={typography.body}>{status.detail}</Text>
        <Text style={typography.support}>Para {request.recipientUids.map(memberName).join(', ')}.</Text>
      </Sheet>
      {request.taskId ? <Sheet>
        <Text style={typography.labelOnNote}>TAREA ASOCIADA</Text>
        <Text style={typography.noteTitle}>{task?.title ?? 'Consultar tarea'}</Text>
        {task ? <Text style={typography.body}>{task.status === 'completed' ? 'Hecha' : task.status === 'cancelled' ? 'Cancelada' : 'Pendiente de completar'}</Text> : null}
        <Text style={typography.support}>Detener o posponer el aviso no marca la tarea como hecha.</Text>
        {request.mode === 'ALARM' ? <Text style={typography.support}>En la app Android actualizada, se vuelve a avisar a los 10 minutos mientras la tarea siga pendiente. Marcarla como hecha retira sus avisos cuando el móvil sincroniza.</Text> : null}
        {task?.status === 'pending' && taskCanChangeCompletion(task) ? <Action disabled={busy} onPress={() => void action.run(async () => {
          await client.updateTask(task, 'completed', ids.current(`${task.id}:${task.version}`, { status: 'completed' }));
          setNotice('Tarea completada. Se ha solicitado retirar sus avisos.');
        })}>Marcar tarea como hecha</Action> : null}
        <Action onPress={() => router.push({ pathname: '/task/[taskId]', params: { taskId: request.taskId! } })}>Ver tarea asociada →</Action>
      </Sheet> : null}
      <Sheet>
        <Text style={typography.labelOnNote}>RESPUESTAS DEL PISO</Text>
        {request.recipientUids.map(uid => {
          const response = alarm.recipients.find(item => item.uid === uid);
          const responseStatus = response && recipientAlarmStatus(alarm, response, state.session!.userId);
          return <View key={uid} style={{ gap: 4 }}>
            <Text style={typography.noteTitle}>{memberName(uid)}</Text>
            <Text style={typography.body}>{responseStatus ? `${responseStatus.decision} · ${responseStatus.reception}` : 'Respuesta y recepción sin confirmar'}</Text>
            <Text style={typography.support}>{responseStatus?.execution ?? 'Sin programación confirmada'}</Text>
            {response?.chosenTimeSpec ? <Text style={typography.support}>Su hora: {formatDateTimeInZone(response.chosenTimeSpec.effectiveAtEpochMs, response.chosenTimeSpec.timeZone)} ({response.chosenTimeSpec.timeZone}).</Text> : null}
          </View>;
        })}
        <Text style={typography.support}>Aceptar y activar son pasos distintos. El estado del móvil cambia cuando llega su confirmación.</Text>
      </Sheet>
      {needsReview ? <><Message text="La propuesta cambió. Revisa el título, la hora, la repetición y la versión antes de volver a decidir." /><Action disabled={busy} selected={reviewed === versionKey} onPress={() => setReviewed(versionKey)}>He revisado la versión {request.requestVersion}</Action></> : null}
      {recipient && request.status === 'ACTIVE' ? <>
        {request.recurrence ? <Sheet><Text style={typography.labelOnNote}>TU AUTORIZACIÓN</Text><View style={styles.row}><Choice label="Solo esta ocasión" selected={consentScope === 'THIS_OCCURRENCE'} onPress={() => { if (!busy) setConsentScope('THIS_OCCURRENCE'); }} /><Choice label="Toda la serie" selected={consentScope === 'SERIES'} onPress={() => { if (!busy) setConsentScope('SERIES'); }} /></View><Text style={typography.support}>La serie mantiene este horario y configuración. Si cambian, volverás a decidir.</Text></Sheet> : null}
        {changing ? <>
          <Sheet><Text style={typography.noteTitle}>Elige tu hora.</Text><Text style={typography.support}>Solo cambia tu aviso. El vencimiento de la tarea y los avisos de los demás se conservan.</Text>
            <Field label="Fecha · AAAA-MM-DD" value={chosen.localDate} editable={!busy} onChangeText={localDate => setChosen(previous => ({ ...previous, localDate }))} />
            <Field label="Hora · HH:mm" value={chosen.localTime} editable={!busy} onChangeText={localTime => setChosen(previous => ({ ...previous, localTime }))} />
            <Field label="Zona horaria" value={chosen.timeZone} autoCapitalize="none" autoCorrect={false} editable={!busy} onChangeText={timeZone => setChosen(previous => ({ ...previous, timeZone }))} />
            {chosenPreview ? <Text style={typography.support}>Tu aviso: {chosenPreview} ({chosen.timeZone}).</Text> : null}
          </Sheet>
          <PrimaryAction label={busy ? 'Guardando…' : 'Aceptar a esta hora'} disabled={busy || !canRespond} onPress={() => respond('ACCEPTED', true)} />
          <Action disabled={busy} onPress={() => { setChanging(false); action.setError(null); }}>Cancelar cambio de hora</Action>
        </> : <>
          {recipient.decision !== 'ACCEPTED' ? <PrimaryAction label={busy ? 'Guardando…' : request.mode === 'ALARM' ? 'Aceptar alarma' : 'Aceptar notificación'} disabled={busy || !canAccept} onPress={() => respond('ACCEPTED')} /> : null}
          {!canAccept && canRespond ? <Text style={typography.support}>La hora anterior ya pasó. Puedes elegir otra hora.</Text> : null}
          <View style={styles.row}><Action disabled={busy || !canRespond} onPress={startChanging}>Elegir otra hora</Action>{recipient.decision === 'ACCEPTED' ? <Action disabled={busy || !canRespond} onPress={() => respond('DISABLED')}>Desactivar mi aviso</Action> : <Action disabled={busy || !canRespond || recipient.decision === 'REJECTED'} onPress={() => respond('REJECTED')}>Rechazar</Action>}</View>
        </>}
      </> : null}
      {state.session.mode === 'live' && recipient?.decision === 'ACCEPTED' && recipient.acceptedRequestVersion === request.requestVersion && request.status === 'ACTIVE' ? <Action onPress={() => router.push({ pathname: '/calendar', params: { alarmId: requestId } })}>Llevar mi aviso a Google Calendar</Action> : null}
      <Message text={notice} /><Message text={action.error} error />
      {recipient?.decision === 'ACCEPTED' ? <Action disabled={busy} onPress={() => void action.run(async () => { setNotice(await client.requestPermissions()); await client.refresh(); })}>Revisar permisos y activación</Action> : null}
      {request.creatorUid === state.session.userId && request.status === 'ACTIVE' ? <View style={{ gap: 12 }}><Action disabled={busy} onPress={() => setConfirmWithdraw(true)}>Retirar propuesta para todos</Action>{confirmWithdraw ? <><Message text="Se retirará la propuesta de todos los destinatarios. Los móviles sin conexión pueden conservar el aviso hasta sincronizar." /><View style={styles.row}><Action disabled={busy} onPress={withdraw}>Confirmar retirada</Action><Action disabled={busy} onPress={() => setConfirmWithdraw(false)}>Conservar propuesta</Action></View></> : null}</View> : null}
      <Text style={typography.support}>Abrir este detalle no acepta nada. Aceptar autoriza el aviso; solo el estado «Programada en el móvil» confirma su activación.</Text>
    </View>
  </AppShell>;
}
const styles = StyleSheet.create({ column: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: 18 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 } });
