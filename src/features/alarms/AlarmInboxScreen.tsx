import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { createDemoAlarmRepository, demoAlarm } from '../../data/alarmRepository';
import type { AlarmSummary } from '../../domain/alarms';

export function AlarmInboxScreen() {
  const [repository] = useState(() => createDemoAlarmRepository());
  const [alarm, setAlarm] = useState<AlarmSummary>(demoAlarm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function respond(decision: 'accepted' | 'rejected') {
    setBusy(true);
    setError(null);
    try { setAlarm(await repository.respond(alarm.id, decision)); }
    catch { setError('No se pudo actualizar el ejemplo.'); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.eyebrow}>COMPROMISOS COMPARTIDOS</Text>
      <Text style={styles.title}>Tú decides cuándo.</Text>
      <Text style={styles.body}>Recibe una propuesta, elige si te viene bien y controla tus avisos.</Text>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>PROPUESTA DE {alarm.proposedBy.toUpperCase()}</Text>
        <Text style={styles.cardTitle}>{alarm.title}</Text>
        <Text style={styles.body}>{alarm.scheduledAt ? new Date(alarm.scheduledAt).toLocaleString() : 'Horario por acordar'}</Text>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" disabled={busy} style={styles.primary} onPress={() => void respond('accepted')}>
            <Text style={styles.primaryText}>Aceptar</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => void respond('rejected')}>
            <Text style={styles.secondaryText}>Rechazar</Text>
          </Pressable>
        </View>
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          {alarm.decision === 'accepted' ? 'Aceptada en la demo · activación pendiente' : alarm.decision === 'rejected' ? 'Rechazada · aviso inactivo' : 'Pendiente de tu respuesta'}
        </Text>
        {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      </View>
      <Text style={styles.note}>Vista de ejemplo con datos en memoria. No envía propuestas ni programa alarmas. Los cambios se pierden al reiniciar.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, backgroundColor: '#f4f7f4', flexGrow: 1 },
  eyebrow: { color: '#36675e', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  title: { color: '#153c35', fontSize: 36, fontWeight: '700' },
  body: { color: '#42534f', fontSize: 16, lineHeight: 24 },
  card: { padding: 22, borderRadius: 22, backgroundColor: '#fff', gap: 16 },
  cardTitle: { fontSize: 25, fontWeight: '600', color: '#153c35' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  primary: { backgroundColor: '#145a50', paddingHorizontal: 22, paddingVertical: 14, borderRadius: 12 },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondary: { backgroundColor: '#e9efec', paddingHorizontal: 22, paddingVertical: 14, borderRadius: 12 },
  secondaryText: { color: '#145a50', fontWeight: '700' },
  note: { color: '#68766e', fontSize: 13, lineHeight: 20 },
});
