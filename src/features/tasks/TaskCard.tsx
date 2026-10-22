import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Note, colors, layout, typography } from '../../ui/index.ts';
import {
  describeTaskCardState,
  describeTaskDue,
  memberInitial,
  type HouseholdTask,
  type TaskWriteState,
} from './model.ts';

export type TaskCardProps = {
  task: HouseholdTask;
  /** Nombre visible resuelto por P2; `null` si el miembro ya no está o no cargó. */
  assigneeName?: string | null;
  index?: number;
  nowEpochMs: number;
  timeZone: string;
  /** Estado del envío según P5. Sin este dato no se afirma que se guardó. */
  write?: TaskWriteState;
  onPress?: () => void;
  /** `true` para etiquetar los datos de demostración. */
  demo?: boolean;
};

/**
 * Tarjeta de tarea como nota de la nevera (`nevera-retro.md` §5.4 y §5.6).
 * El estado visible sale de `describeTaskCardState`; nunca se inventa «hecho»
 * a partir de una alarma detenida.
 */
export function TaskCard({
  task,
  assigneeName = null,
  index = 0,
  nowEpochMs,
  timeZone,
  write,
  onPress,
  demo = false,
}: TaskCardProps) {
  const state = describeTaskCardState(task, write);
  const done = task.status === 'completed' && (write === undefined || write.sync === 'CONFIRMED');
  const cancelled = task.status === 'cancelled' && (write === undefined || write.sync === 'CONFIRMED');
  const due = describeTaskDue(task, nowEpochMs, timeZone);
  const label = demo ? `DEMO · TAREA · ${due.toUpperCase()}` : `TAREA · ${due.toUpperCase()}`;

  const body = (
    <Note index={index} label={label} title={task.title}>
      <View style={styles.rows}>
        <View style={styles.row}>
          <StatusMark done={done} cancelled={cancelled} />
          <Text style={[styles.statusText, done && styles.struck, cancelled && styles.cancelled]}>
            {state.label}
          </Text>
        </View>

        <View style={styles.row}>
          <View style={[styles.avatar, task.assigneeUid === null && styles.avatarEmpty]}>
            <Text style={[styles.avatarText, task.assigneeUid === null && styles.avatarTextEmpty]}>
              {memberInitial(assigneeName, task.assigneeUid ?? '?')}
            </Text>
          </View>
          <Text style={typography.support}>{assigneeName ?? (task.assigneeUid === null ? 'Sin asignar' : 'Responsable')}</Text>
          <Text style={styles.version}>v{task.version}</Text>
        </View>

        {due !== 'Sin fecha' ? <Text style={typography.support}>{due}</Text> : null}
        {state.detail !== null ? (
          <Text style={[typography.support, state.tone === 'error' && styles.error, state.tone === 'pending' && styles.pending]}>
            {state.detail}
          </Text>
        ) : null}
      </View>
    </Note>
  );

  if (onPress === undefined) return body;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir tarea ${task.title}`}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

function StatusMark({ done, cancelled }: { done: boolean; cancelled: boolean }) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no"
      style={[styles.checkbox, done && styles.checkboxDone, cancelled && styles.checkboxCancelled]}
    >
      {done ? <Text style={styles.check}>✓</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { gap: 6, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusText: { ...typography.body, fontSize: 12 },
  struck: { textDecorationLine: 'line-through', color: colors.noteMuted },
  cancelled: { color: colors.noteMuted },
  checkbox: {
    width: 14,
    height: 14,
    borderWidth: 1,
    borderColor: colors.ntx,
    borderRadius: layout.radius,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  checkboxDone: { backgroundColor: colors.ntx, borderColor: colors.ntx },
  checkboxCancelled: { borderColor: colors.noteMuted, opacity: 0.6 },
  check: { color: '#fff8ef', fontSize: 10, lineHeight: 12, fontWeight: '700' },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.ntx,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmpty: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.noteLine },
  avatarText: { ...typography.label, color: colors.onAvatar, fontSize: 10, letterSpacing: 0 },
  avatarTextEmpty: { color: colors.noteLabel },
  version: { ...typography.support, color: colors.noteLabel, marginLeft: 'auto', fontVariant: ['tabular-nums'] },
  error: { color: '#8c2b22' },
  pending: { color: '#6a4a12' },
  pressed: { opacity: 0.9 },
});
