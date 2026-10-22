import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ProgressBar, TaskRow } from '../../src/features/skeleton/components.tsx';
import { completedTaskCount, pendingTasks, type TaskPriority } from '../../src/features/skeleton/model.ts';
import { useSkeleton } from '../../src/features/skeleton/store.tsx';
import { priorityLabel } from '../../src/features/tasks/taskTime.ts';
import { useTaskAlarms } from '../../src/features/tasks/useTaskAlarms.ts';
import {
  AnimatedIn,
  Chip,
  FlashMessage,
  IconButton,
  Note,
  Screen,
  ScreenHeader,
  TextField,
  typography,
} from '../../src/ui/index.ts';

const VISIBLE_LIMIT = 4;

/** Tareas: añadir, marcar y quitar sin salir de la pantalla ni hacer scroll. */
export default function TareasRoute() {
  const { state, actions } = useSkeleton();
  const alarms = useTaskAlarms();
  const [draft, setDraft] = useState('');
  const [timeDraft, setTimeDraft] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [flash, setFlash] = useState<{ id: number; text: string } | null>(null);
  const pending = pendingTasks(state);
  const done = completedTaskCount(state);
  const visible = state.tasks.slice(0, VISIBLE_LIMIT);
  const hidden = state.tasks.length - visible.length;
  const canAdd = draft.trim().length > 0 && state.tasks.length < 6;
  const capabilities = alarms.capabilities;
  const needsPermission = capabilities !== null
    && capabilities.available
    && !capabilities.audibleAlarms;
  const unavailable = capabilities !== null && !capabilities.available;

  const submit = () => {
    if (!canAdd) return;
    actions.addTask(draft, { time: timeDraft, priority });
    setDraft('');
    setTimeDraft('');
    setFlash({ id: Date.now(), text: 'Tarea añadida al piso' });
  };

  const cyclePriority = () => {
    setPriority((current) => (
      current === 'low' ? 'normal' : current === 'normal' ? 'high' : 'low'
    ));
  };

  return (
    <Screen contentStyle={styles.page}>
      <ScreenHeader eyebrow="LO QUE TOCA HOY" title="Tareas" />

      <AnimatedIn>
        <View style={styles.summary}>
          <Text style={typography.bodyOnDoor}>
            {pending.length} pendientes · {done} hechas
          </Text>
          <View style={styles.progress}>
            <ProgressBar value={done} total={state.tasks.length} />
          </View>
        </View>
      </AnimatedIn>

      {needsPermission || unavailable ? (
        <View style={styles.alarmBanner}>
          <Text style={styles.alarmText}>
            {unavailable
              ? 'Las alarmas reales requieren una development build Android.'
              : 'Faltan permisos para que la alarma suene con la app cerrada.'}
          </Text>
          {capabilities?.available ? (
            <Chip
              label="Permisos"
              onPress={() => void alarms.requestPermissions()}
              accessibilityLabel="Conceder permisos de alarma"
            />
          ) : null}
        </View>
      ) : null}

      <Note
        index={0}
        wide
        label="Piso · hoy"
        title={pending.length > 0 ? `${pending.length} por hacer` : 'Todo hecho'}
        style={styles.note}
      >
        {visible.length === 0 ? (
          <Text style={typography.support}>No queda nada. Añade la primera tarea del piso.</Text>
        ) : (
          visible.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={() => void alarms.toggleTask(task)}
              onRemove={() => void alarms.removeTask(task)}
              onToggleAlarm={() => void alarms.toggleAlarm(task)}
              onToggleMute={() => void alarms.toggleMute(task)}
              busy={alarms.busyTaskId !== null}
            />
          ))
        )}

        <View style={styles.addBlock}>
          <TextField
            value={draft}
            onChangeText={setDraft}
            placeholder="Añadir tarea"
            onSubmitEditing={submit}
            maxLength={60}
            style={styles.input}
          />
          <View style={styles.addMeta}>
            <TextField
              value={timeDraft}
              onChangeText={setTimeDraft}
              placeholder="Cuándo: 21:00, mañana, lunes"
              onSubmitEditing={submit}
              maxLength={24}
              style={styles.timeInput}
            />
            <Chip
              label={priorityLabel(priority)}
              onPress={cyclePriority}
              accessibilityLabel={`Prioridad ${priorityLabel(priority)}. Toca para cambiar.`}
            />
            <IconButton name="plus" onPress={submit} disabled={!canAdd} accessibilityLabel="Añadir tarea" />
          </View>
        </View>
      </Note>

      <FlashMessage
        key={alarms.message ?? flash?.id ?? 'idle'}
        message={alarms.message ?? flash?.text ?? null}
      />

      <Text style={styles.hint}>
        {hidden > 0
          ? `Y ${hidden} más en el piso. Marca o quita las visibles para verlas.`
          : 'Toca «Aviso» para programar una alarma real. La campana silencia el aviso.'}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 4,
    gap: 12,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  progress: {
    width: 132,
  },
  note: {
    flexShrink: 1,
  },
  alarmBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(43, 39, 35, 0.12)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  alarmText: {
    ...typography.label,
    flex: 1,
  },
  addBlock: {
    gap: 6,
    marginTop: 10,
  },
  addMeta: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
  },
  timeInput: {
    flex: 1,
    fontSize: 16,
  },
  hint: {
    ...typography.label,
    marginTop: 'auto',
  },
});
