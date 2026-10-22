import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryAction, Sheet, colors, layout, typography } from '../../ui/index.ts';
import {
  describeTaskCardState,
  taskCanChangeCompletion,
  describeTaskDue,
  memberInitial,
  type HouseholdTask,
  type TaskWriteState,
} from './model.ts';

export type TaskDetailProps = {
  task: HouseholdTask;
  assigneeName: string | null;
  nowEpochMs: number;
  timeZone: string;
  write?: TaskWriteState;
  busy?: boolean;
  error?: string | null;
  demo?: boolean;
  onComplete: () => void;
  onCancel: () => void;
  onBack?: () => void;
};

/**
 * Detalle de tarea (`/task/[taskId]`, ruta de P6).
 *
 * La pantalla no escribe en Firestore ni programa alarmas: muestra el estado
 * vigente y delega en `TaskRepository` (P5) y en las operaciones de P3.
 * Completar produce un plan de retirada de alarmas; hasta el acuse, la UI lo
 * presenta como pendiente y no como cancelación aplicada.
 */
export function TaskDetail({
  task,
  assigneeName,
  nowEpochMs,
  timeZone,
  write,
  busy = false,
  error = null,
  demo = false,
  onComplete,
  onCancel,
  onBack,
}: TaskDetailProps) {
  const state = describeTaskCardState(task, write);
  const closed = task.status !== 'pending';
  const withdrawalPending = write?.alarmWithdrawal === 'pending';

  return (
    <View style={styles.page}>
      {onBack === undefined ? null : (
        <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}>
          <Text style={typography.label}>← TABLÓN</Text>
        </Pressable>
      )}

      <Text style={typography.label}>{demo ? 'TAREA · DEMO' : 'TAREA DEL GRUPO'}</Text>

      <Sheet>
        <Text style={typography.detailTitle}>{task.title}</Text>

        <View style={styles.meta}>
          <MetaRow label="RESPONSABLE">
            <View style={styles.personRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {memberInitial(assigneeName, task.assigneeUid ?? '?')}
                </Text>
              </View>
              <Text style={typography.body}>
                {task.assigneeUid === null ? 'Sin asignar' : assigneeName ?? 'Miembro del grupo'}
              </Text>
            </View>
          </MetaRow>
          <MetaRow label="VENCIMIENTO">
            <Text style={typography.body}>{describeTaskDue(task, nowEpochMs, timeZone)}</Text>
          </MetaRow>
          <MetaRow label="ESTADO">
            <Text style={typography.body}>{state.label}</Text>
          </MetaRow>
          <MetaRow label="VERSIÓN">
            <Text style={[typography.body, styles.tabular]}>v{task.version}</Text>
          </MetaRow>
        </View>

        {state.detail !== null ? (
          <View style={[styles.banner, state.tone === 'error' && styles.bannerError]}>
            <Text style={typography.support}>{state.detail}</Text>
          </View>
        ) : null}

        {withdrawalPending ? (
          <View style={styles.banner}>
            <Text style={typography.support}>
              Retirada de alarmas solicitada. El móvil que las tiene aún no ha confirmado:
              puede sonar hasta que se reconcilie.
            </Text>
          </View>
        ) : null}

        {error !== null ? (
          <Text accessibilityRole="alert" style={[typography.support, styles.error]}>
            {error}
          </Text>
        ) : null}

        <Text style={styles.hint}>
          Detener o posponer una alarma no completa la tarea. Completarla aquí invalida sus
          alarmas vinculadas en el servidor.
        </Text>
      </Sheet>

      {closed ? (
        <Text style={[typography.bodyOnDoor, styles.closedNote]}>
          {write !== undefined && write.sync !== 'CONFIRMED' ? 'El cambio todavía no está confirmado.' : task.status === 'completed' ? 'Esta tarea ya está completada.' : 'Esta tarea está cancelada.'}
        </Text>
      ) : (
        <View style={styles.actions}>
          <PrimaryAction
            label={busy ? 'Guardando…' : 'Completar tarea'}
            onPress={onComplete}
            disabled={busy || !taskCanChangeCompletion(task)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={onCancel}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed, busy && styles.disabled]}
          >
            <Text style={styles.secondaryText}>Cancelar tarea</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.metaRow}>
      <Text style={typography.labelOnNote}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 12 },
  back: { alignSelf: 'flex-start', paddingVertical: 6, minHeight: layout.minTouchTarget, justifyContent: 'center' },
  meta: { gap: 10, marginTop: 6 },
  metaRow: { gap: 3 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.ntx,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.label, color: colors.onAvatar, fontSize: 10, letterSpacing: 0 },
  tabular: { fontVariant: ['tabular-nums'] },
  banner: {
    borderWidth: 1,
    borderColor: colors.noteLine,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: layout.radius,
  },
  bannerError: { borderColor: '#8c2b22' },
  error: { color: '#8c2b22' },
  hint: { ...typography.support, marginTop: 4 },
  actions: { gap: 10 },
  secondary: {
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.ln,
    borderRadius: layout.radius,
    paddingHorizontal: 12,
  },
  secondaryText: { ...typography.tab, color: colors.tx },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.55 },
  closedNote: { marginTop: 8 },
});
