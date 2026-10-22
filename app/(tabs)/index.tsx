import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { ProgressBar } from '../../src/features/skeleton/components.tsx';
import {
  completedTaskCount,
  formatEuros,
  nextTask,
  pendingTasks,
  unsettledTotalCents,
} from '../../src/features/skeleton/model.ts';
import { useSkeleton } from '../../src/features/skeleton/store.tsx';
import { alarmChipLabel, alarmDetail } from '../../src/features/tasks/taskTime.ts';
import { useTaskAlarms } from '../../src/features/tasks/useTaskAlarms.ts';
import {
  AnimatedIn,
  Checkbox,
  Chip,
  Note,
  Screen,
  ScreenHeader,
  tabularNums,
  typography,
} from '../../src/ui/index.ts';

/** Tablón: lo que hay que saber hoy, sin scroll y con la próxima tarea accionable. */
export default function TablonRoute() {
  const router = useRouter();
  const { state } = useSkeleton();
  const alarms = useTaskAlarms();
  const pending = pendingTasks(state);
  const done = completedTaskCount(state);
  const next = nextTask(state);
  const owed = unsettledTotalCents(state);
  const whenLabel = next
    ? (/^\d/.test(next.time) ? `Hoy · ${next.time}` : next.time)
    : 'Todo al día';

  return (
    <Screen contentStyle={styles.page}>
      <ScreenHeader eyebrow="LA PUERTA DE LA NEVERA" title="Tablón" />

      <AnimatedIn>
        <Note
          index={0}
          wide
          label={whenLabel}
          title={next ? next.title : 'No queda nada pendiente'}
        >
          {next ? (
            <View style={styles.nextRow}>
              <Checkbox
                checked={false}
                onToggle={() => void alarms.toggleTask(next)}
                accessibilityLabel={`Marcar ${next.title} como hecha`}
              />
              <View style={styles.nextText}>
                <Text style={typography.support}>{alarmDetail(next)}</Text>
                <View style={styles.nextActions}>
                  <Chip
                    label={alarmChipLabel(next)}
                    selected={next.alarmStatus === 'scheduled' || next.alarmStatus === 'fired'}
                    onPress={() => void alarms.toggleAlarm(next)}
                    accessibilityLabel={`${alarmChipLabel(next)}: ${next.title}`}
                  />
                  {next.alarmEnabled ? (
                    <Chip
                      label={next.alarmMode === 'NOTIFICATION' ? 'Silenciosa' : 'Con sonido'}
                      onPress={() => void alarms.toggleMute(next)}
                      accessibilityLabel="Cambiar sonido del aviso"
                    />
                  ) : null}
                </View>
              </View>
            </View>
          ) : (
            <Text style={typography.support}>Buen trabajo. Añade otra en Tareas.</Text>
          )}
        </Note>
      </AnimatedIn>

      <View style={styles.board}>
        <AnimatedIn delay={70} style={styles.column}>
          <Note index={1} label="Tareas" title={`${done} de ${state.tasks.length} hechas`}>
            <Text style={typography.support}>{pending.length} pendientes</Text>
            <ProgressBar value={done} total={state.tasks.length} />
          </Note>
        </AnimatedIn>
        <AnimatedIn delay={120} style={styles.column}>
          <Note
            index={2}
            label="Gastos"
            title={formatEuros(owed)}
            onPress={() => router.push('/gastos')}
            accessibilityLabel="Abrir gastos pendientes"
          >
            <Text style={typography.support}>Pendiente de pagar</Text>
          </Note>
        </AnimatedIn>
      </View>

      <AnimatedIn delay={170}>
        <Note
          index={3}
          label="Aviso · martes"
          title="El casero viene el martes"
          onPress={() => router.push('/piso')}
          accessibilityLabel="Abrir información del piso"
        >
          <Text style={typography.support}>Sube a las 10:00 y trae la llave del cuarto.</Text>
        </Note>
      </AnimatedIn>

      <Text style={[styles.caption, tabularNums]}>
        {alarms.message ?? `${done} de ${state.tasks.length} tareas · ${formatEuros(owed)} pendientes`}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 10,
    gap: 12,
  },
  nextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  nextText: {
    flex: 1,
    gap: 2,
  },
  nextActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  board: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  column: {
    flex: 1,
  },
  caption: {
    ...typography.label,
    marginTop: 'auto',
    paddingTop: 8,
  },
});
