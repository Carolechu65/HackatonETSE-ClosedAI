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
import {
  AnimatedIn,
  Checkbox,
  Note,
  Screen,
  ScreenHeader,
  tabularNums,
  typography,
} from '../../src/ui/index.ts';

/** Tablón: lo que hay que saber hoy, sin scroll y con la próxima tarea accionable. */
export default function TablonRoute() {
  const router = useRouter();
  const { state, actions } = useSkeleton();
  const pending = pendingTasks(state);
  const done = completedTaskCount(state);
  const next = nextTask(state);
  const owed = unsettledTotalCents(state);
  const whenLabel = next
    ? (/^\d/.test(next.time) ? `Hoy · ${next.time}` : next.time)
    : 'Todo al día';

  return (
    <Screen contentStyle={styles.page}>
      <ScreenHeader brand title="Tablón" />

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
                onToggle={() => actions.toggleTask(next.id)}
                accessibilityLabel={`Marcar ${next.title} como hecha`}
              />
              <View style={styles.nextText}>
                <Text style={typography.support}>Te lo propuso Luis</Text>
                <Text style={typography.labelOnNote}>Aceptada · activación pendiente</Text>
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
            onPress={() => router.push('/preview/gastos')}
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
          onPress={() => router.push('/preview/piso')}
          accessibilityLabel="Abrir información del piso"
        >
          <Text style={typography.support}>Sube a las 10:00 y trae la llave del cuarto.</Text>
        </Note>
      </AnimatedIn>

      <Text style={[styles.caption, tabularNums]}>
        {done} de {state.tasks.length} tareas · {formatEuros(owed)} pendientes
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
