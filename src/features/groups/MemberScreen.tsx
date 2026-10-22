import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useProduct } from '../../composition/ProductProvider.tsx';
import { currentRecipient, recipientAlarmStatus } from '../../composition/product.ts';
import { formatDateTimeInZone } from '../../domain/time.ts';
import { AppShell, BackLink } from '../../ui/AppShell.tsx';
import { Action, Message, useAction } from '../../ui/Controls.tsx';
import { Note, typography } from '../../ui/index.ts';
import { memberAlarms } from './memberAlarms.ts';

export function MemberScreen({ userId, groupId }: { userId: string; groupId: string }) {
  const { state, client } = useProduct();
  const action = useAction();
  const member = groupId === state.groupId ? state.members.find(item => item.userId === userId) : undefined;
  const alarms = memberAlarms(state, groupId, userId);
  return <AppShell title={member ? `Avisos para ${member.displayName}` : 'Persona no disponible'} eyebrow="PERSONAS DEL PISO">
    <BackLink to="/group" label="Volver al piso" />
    {!member ? <Message text="Esta persona no pertenece al piso seleccionado. Vuelve al piso para elegir a alguien." /> : <>
      <Text style={typography.bodyOnDoor}>Alarmas y notificaciones que tú le has enviado.</Text>
      <Action disabled={action.busy || state.syncing} onPress={() => void action.run(() => client.refresh())}>Actualizar avisos</Action>
      <Message text={action.error} error />
      {!alarms.length ? <Note index={2} wide label="SIN AVISOS" title="Todavía no le has enviado avisos."><Text style={typography.support}>Cuando le propongas una alarma o una notificación, aparecerá aquí.</Text></Note> : alarms.map((alarm, index) => {
        const recipient = currentRecipient(alarm, userId);
        const status = recipient && recipientAlarmStatus(alarm, recipient, state.session!.userId);
        const time = recipient?.chosenTimeSpec ?? alarm.request.timeSpec;
        return <Pressable key={alarm.requestId} accessibilityRole="link" accessibilityLabel={`Ver detalle de ${alarm.request.title} para ${member.displayName}`} onPress={() => router.push(`/alarm/${alarm.requestId}`)} style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}>
          <Note index={index + 1} wide label={alarm.request.mode === 'ALARM' ? 'ALARMA SONORA' : 'NOTIFICACIÓN'} title={alarm.request.title}>
            {alarm.request.note ? <Text style={typography.body}>{alarm.request.note}</Text> : null}
            <Text style={typography.bodyStrong}>{formatDateTimeInZone(time.effectiveAtEpochMs, time.timeZone)}</Text>
            <Text style={typography.support}>{time.timeZone}{alarm.request.recurrence ? ' · Cada semana' : ''}</Text>
            {recipient?.chosenTimeSpec ? <Text style={typography.support}>Hora propuesta: {formatDateTimeInZone(alarm.request.timeSpec.effectiveAtEpochMs, alarm.request.timeSpec.timeZone)}.</Text> : null}
            {alarm.request.status !== 'ACTIVE' ? <Text style={typography.labelOnNote}>{alarm.request.status === 'WITHDRAWN' ? 'Propuesta retirada' : 'Propuesta vencida'}</Text> : null}
            <View style={{ gap: 4 }}><Text style={typography.body}>{status ? `${status.decision} · ${status.reception}` : 'Respuesta y recepción sin confirmar'}</Text><Text style={typography.support}>{status?.execution ?? 'Sin programación confirmada'}</Text></View>
            <Text style={typography.labelOnNote}>Ver detalle →</Text>
          </Note>
        </Pressable>;
      })}
    </>}
  </AppShell>;
}
const styles = StyleSheet.create({ card: { width: '100%', minWidth: 0 } });
