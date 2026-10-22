import { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  alarmRuntime,
  type AlarmCapabilities,
  type LocalOccurrence,
  type OccurrenceKey,
  type RuntimeOccurrence,
  type RuntimeSnapshot,
} from '../../platform/alarms';

const DELAY_OPTIONS = [10, 30, 60] as const;

const STATUS_LABEL: Record<RuntimeOccurrence['status'], string> = {
  SCHEDULING: 'Programando',
  SCHEDULED: 'Programada',
  CANCELLED: 'Cancelada',
  FIRED: 'Disparada',
  FAILED: 'Fallida',
  EXPIRED: 'Vencida',
};

const STATUS_COLOR: Record<RuntimeOccurrence['status'], string> = {
  SCHEDULING: '#9a6b12',
  SCHEDULED: '#145a50',
  CANCELLED: '#68766e',
  FIRED: '#9a3d12',
  FAILED: '#a12b2b',
  EXPIRED: '#68766e',
};

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Error inesperado del runtime.';
}

function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid';
  } catch {
    return 'Europe/Madrid';
  }
}

function keyFromOccurrence(occurrence: RuntimeOccurrence): OccurrenceKey {
  const { userId, requestId, occurrenceId, deviceId, deviceEpoch } = occurrence.spec;
  return { userId, requestId, occurrenceId, deviceId, deviceEpoch };
}

function latestActiveOccurrence(snapshot: RuntimeSnapshot | null): RuntimeOccurrence | undefined {
  if (!snapshot) return undefined;
  const candidates = snapshot.occurrences.filter(
    (occurrence) => occurrence.status === 'FIRED' || occurrence.status === 'SCHEDULED',
  );
  return candidates.slice(-1)[0];
}

/**
 * Banco de pruebas del runtime Android.
 *
 * No representa una propuesta aceptada ni escribe en Firebase. Sirve para
 * comprobar permisos, programación exacta, sonido, detener, posponer y
 * recuperación en una development build.
 */
export function AlarmRuntimeLabScreen() {
  const [capabilities, setCapabilities] = useState<AlarmCapabilities | null>(null);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [delaySeconds, setDelaySeconds] = useState<number>(30);
  const [activeKey, setActiveKey] = useState<OccurrenceKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextCapabilities, nextSnapshot] = await Promise.all([
      alarmRuntime.getCapabilities(),
      alarmRuntime.getSnapshot(),
    ]);
    setCapabilities(nextCapabilities);
    setSnapshot(nextSnapshot);
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = () => {
      refresh().catch((error: unknown) => {
        if (mounted) setMessage(toMessage(error));
      });
    };
    load();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [refresh]);

  async function run(action: () => Promise<string | null>) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      await refresh();
      if (result) setMessage(result);
    } catch (error) {
      setMessage(toMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function requestPermissions() {
    void run(async () => {
      const exact = await alarmRuntime.requestExactAlarmPermission();
      const notifications = await alarmRuntime.requestNotificationPermission();
      return exact || notifications
        ? 'Completa las pantallas del sistema y vuelve: las capacidades se actualizan al recuperar el foco.'
        : 'No se pudo abrir la solicitud de permisos en este dispositivo.';
    });
  }

  function scheduleAlarm() {
    void run(async () => {
      const occurrenceId = `demo-${Date.now()}`;
      const key: OccurrenceKey = {
        userId: 'demo-user',
        requestId: `demo-request-${occurrenceId}`,
        occurrenceId,
        deviceId: 'demo-device',
        deviceEpoch: 1,
      };
      const occurrence: LocalOccurrence = {
        ...key,
        requestVersion: 1,
        decisionRevision: 1,
        effectiveAtEpochMs: Date.now() + delaySeconds * 1000,
        timeZone: resolveTimeZone(),
        title: 'Prueba de alarma',
        mode: 'ALARM',
      };

      const result = await alarmRuntime.schedule(occurrence);
      if (result.status === 'SCHEDULED') {
        setActiveKey(key);
        return `Programada para dentro de ${delaySeconds} s. Bloquea el móvil o cierra la app: debe sonar igualmente.`;
      }
      if (result.status === 'PENDING_PERMISSION') {
        return `Aceptada pero no programada: falta ${result.reason}.`;
      }
      return `No se pudo programar: ${result.reason}`;
    });
  }

  function stopAlarm() {
    const key = activeKey ?? (() => {
      const occurrence = latestActiveOccurrence(snapshot);
      return occurrence ? keyFromOccurrence(occurrence) : null;
    })();
    if (!key) {
      setMessage('No hay una alarma activa en esta sesión.');
      return;
    }
    void run(async () => {
      const stopped = await alarmRuntime.stop(key);
      return stopped ? 'Alarma detenida o cancelada.' : 'La ocurrencia ya no existía.';
    });
  }

  function snoozeAlarm() {
    const key = activeKey ?? (() => {
      const occurrence = latestActiveOccurrence(snapshot);
      return occurrence ? keyFromOccurrence(occurrence) : null;
    })();
    if (!key) {
      setMessage('No hay una alarma activa en esta sesión.');
      return;
    }
    void run(async () => {
      const result = await alarmRuntime.snooze(key, 5);
      if (result.status === 'SCHEDULED') return 'Pospuesta 5 minutos con la misma identidad.';
      return `No se pudo posponer: ${result.reason ?? result.status}`;
    });
  }

  function reconcile() {
    void run(async () => {
      const result = await alarmRuntime.reconcile();
      return `Recuperación: ${result.rescheduled} reprogramadas, ${result.expired} vencidas, ${result.failed} fallidas.`;
    });
  }

  const available = capabilities?.available === true;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.eyebrow}>P4 · RUNTIME ANDROID</Text>
      <Text style={styles.title}>Alarma real, sin JS vivo.</Text>
      <Text style={styles.body}>
        Esta pantalla habla directamente con el módulo nativo. Programa una alarma exacta que debe
        sonar con la app cerrada y permite detenerla o posponerla desde la notificación.
      </Text>
      <View style={styles.warning}>
        <Text style={styles.warningText}>
          Requiere development build Android. En Expo Go el módulo no existe y no se programa nada.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Permisos y capacidades</Text>
        <CapabilityRow
          label="Módulo nativo"
          ok={available}
          value={available ? 'Disponible' : 'No instalado'}
        />
        <CapabilityRow
          label="Alarmas exactas"
          ok={capabilities?.exactAlarms === true}
          value={capabilities?.exactAlarms ? 'Concedidas' : 'Pendientes'}
        />
        <CapabilityRow
          label="Notificaciones"
          ok={capabilities?.notifications === true}
          value={capabilities?.notifications ? 'Concedidas' : 'Pendientes'}
        />
        <CapabilityRow
          label="Pantalla completa"
          ok={capabilities?.fullScreenIntent === true}
          value={capabilities?.fullScreenIntent ? 'Permitida' : 'No (se usa notificación)'}
        />
        <CapabilityRow
          label="Sonido de alarma"
          ok={capabilities?.audibleAlarms === true}
          value={capabilities?.audibleAlarms ? 'Listo' : 'Bloqueado por permisos'}
        />
        {capabilities?.reason ? <Text style={styles.reason}>{capabilities.reason}</Text> : null}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={requestPermissions}
            style={[styles.secondary, busy && styles.disabled]}
          >
            <Text style={styles.secondaryText}>Pedir permisos</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void run(async () => {
              await alarmRuntime.openNotificationSettings();
              return 'Ajustes de notificaciones abiertos.';
            })}
            style={[styles.secondary, busy && styles.disabled]}
          >
            <Text style={styles.secondaryText}>Ajustes de avisos</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Programar prueba</Text>
        <Text style={styles.body}>Elige cuánto tarda en sonar desde que pulsas el botón.</Text>
        <View style={styles.chips}>
          {DELAY_OPTIONS.map((seconds) => {
            const selected = delaySeconds === seconds;
            return (
              <Pressable
                key={seconds}
                accessibilityRole="button"
                onPress={() => setDelaySeconds(seconds)}
                style={[styles.chip, selected && styles.chipActive]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                  {seconds === 60 ? '1 min' : `${seconds} s`}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={busy || !available}
          onPress={scheduleAlarm}
          style={[styles.primary, (busy || !available) && styles.disabled]}
        >
          <Text style={styles.primaryText}>Programar alarma real</Text>
        </Pressable>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={stopAlarm}
            style={[styles.secondary, busy && styles.disabled]}
          >
            <Text style={styles.secondaryText}>Detener</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={snoozeAlarm}
            style={[styles.secondary, busy && styles.disabled]}
          >
            <Text style={styles.secondaryText}>Posponer 5 min</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Store nativo</Text>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void run(async () => {
                await refresh();
                return null;
              })}
              style={[styles.linkButton, busy && styles.disabled]}
            >
              <Text style={styles.linkText}>Actualizar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void reconcile()}
              style={[styles.linkButton, busy && styles.disabled]}
            >
              <Text style={styles.linkText}>Reconciliar</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.body}>
          {snapshot && snapshot.occurrences.length > 0
            ? `${snapshot.occurrences.length} ocurrencia(s) · revisión ${snapshot.revision}`
            : 'Todavía no hay ocurrencias registradas.'}
        </Text>
        {snapshot?.occurrences.map((occurrence) => (
          <View key={occurrence.spec.occurrenceId} style={styles.occurrence}>
            <View style={styles.occurrenceHeader}>
              <Text style={styles.occurrenceTitle}>{occurrence.spec.title}</Text>
              <Text style={[styles.status, { color: STATUS_COLOR[occurrence.status] }]}>
                {STATUS_LABEL[occurrence.status]}
              </Text>
            </View>
            <Text style={styles.occurrenceMeta}>
              {new Date(occurrence.spec.effectiveAtEpochMs).toLocaleString()} · {occurrence.spec.mode}
              {occurrence.snoozeCount ? ` · pospuesta ${occurrence.snoozeCount}×` : ''}
            </Text>
            {occurrence.failureReason ? (
              <Text style={styles.failure}>{occurrence.failureReason}</Text>
            ) : null}
          </View>
        ))}
      </View>

      {message ? (
        <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>
      ) : null}
      <Text style={styles.note}>
        Límites conocidos: no sobrevive a «Forzar detención» de Android, requiere el primer
        desbloqueo tras reiniciar y respeta el modo silencio/No molestar del sistema.
      </Text>
    </ScrollView>
  );
}

function CapabilityRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, ok ? styles.ok : styles.bad]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 18, backgroundColor: '#f4f7f4', flexGrow: 1 },
  eyebrow: { color: '#36675e', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  title: { color: '#153c35', fontSize: 34, fontWeight: '700' },
  body: { color: '#42534f', fontSize: 16, lineHeight: 24 },
  warning: { borderRadius: 14, backgroundColor: '#fff3d6', padding: 14 },
  warningText: { color: '#6d4c0a', fontSize: 14, lineHeight: 20, fontWeight: '600' },
  card: { padding: 22, borderRadius: 22, backgroundColor: '#fff', gap: 14 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cardTitle: { fontSize: 21, fontWeight: '700', color: '#153c35' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowLabel: { color: '#42534f', fontSize: 15, flexShrink: 1 },
  rowValue: { fontSize: 14, fontWeight: '700', textAlign: 'right' },
  ok: { color: '#145a50' },
  bad: { color: '#a12b2b' },
  reason: { color: '#9a6b12', fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  primary: { backgroundColor: '#145a50', paddingHorizontal: 22, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondary: { backgroundColor: '#e9efec', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12 },
  secondaryText: { color: '#145a50', fontWeight: '700', fontSize: 14 },
  linkButton: { paddingVertical: 4 },
  linkText: { color: '#145a50', fontWeight: '700', fontSize: 14 },
  chips: { flexDirection: 'row', gap: 10 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: '#c8d6d0', paddingHorizontal: 18, paddingVertical: 9 },
  chipActive: { backgroundColor: '#145a50', borderColor: '#145a50' },
  chipText: { color: '#145a50', fontWeight: '700', fontSize: 14 },
  chipTextActive: { color: '#fff' },
  disabled: { opacity: 0.45 },
  occurrence: { borderTopWidth: 1, borderTopColor: '#eef2ef', paddingTop: 12, gap: 4 },
  occurrenceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  occurrenceTitle: { color: '#153c35', fontSize: 15, fontWeight: '700', flexShrink: 1 },
  status: { fontSize: 13, fontWeight: '800' },
  occurrenceMeta: { color: '#68766e', fontSize: 13 },
  failure: { color: '#a12b2b', fontSize: 12, fontWeight: '600' },
  message: { borderRadius: 14, backgroundColor: '#e4ede9', color: '#145a50', padding: 16, fontSize: 14, lineHeight: 21, fontWeight: '600' },
  note: { color: '#68766e', fontSize: 13, lineHeight: 20 },
});
