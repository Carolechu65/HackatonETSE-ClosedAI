import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ProgressBar, TaskRow } from '../../src/features/skeleton/components.tsx';
import { completedTaskCount, pendingTasks } from '../../src/features/skeleton/model.ts';
import { useSkeleton } from '../../src/features/skeleton/store.tsx';
import {
  AnimatedIn,
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
  const [draft, setDraft] = useState('');
  const [flash, setFlash] = useState<{ id: number; text: string } | null>(null);
  const pending = pendingTasks(state);
  const done = completedTaskCount(state);
  const visible = state.tasks.slice(0, VISIBLE_LIMIT);
  const hidden = state.tasks.length - visible.length;
  const canAdd = draft.trim().length > 0 && state.tasks.length < 6;

  const submit = () => {
    if (!canAdd) return;
    actions.addTask(draft);
    setDraft('');
    setFlash({ id: Date.now(), text: 'Tarea añadida al piso' });
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
              onToggle={() => actions.toggleTask(task.id)}
              onRemove={() => actions.removeTask(task.id)}
            />
          ))
        )}

        <View style={styles.addRow}>
          <TextField
            value={draft}
            onChangeText={setDraft}
            placeholder="Añadir tarea"
            onSubmitEditing={submit}
            maxLength={60}
            style={styles.input}
          />
          <IconButton name="plus" onPress={submit} disabled={!canAdd} accessibilityLabel="Añadir tarea" />
        </View>
      </Note>

      <FlashMessage key={flash?.id ?? 'idle'} message={flash?.text ?? null} />

      <Text style={styles.hint}>
        {hidden > 0
          ? `Y ${hidden} más en el piso. Marca o quita las visibles para verlas.`
          : 'Toca la casilla para marcar. La X quita la tarea de la vista.'}
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
  addRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginTop: 10,
  },
  input: {
    flex: 1,
  },
  hint: {
    ...typography.label,
    marginTop: 'auto',
  },
});
