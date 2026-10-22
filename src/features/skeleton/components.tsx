import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import {
  Checkbox,
  Chip,
  Icon,
  PressableScale,
  colors,
  tabularNums,
  typography,
} from '../../ui/index.ts';
import { formatEuros, type Expense, type Task } from './model.ts';
import { alarmChipLabel, taskMetaLabel } from '../tasks/taskTime.ts';

/** Barra de progreso de 6 px (guía §5.6) que crece al cambiar de valor. */
export function ProgressBar({ value, total }: { value: number; total: number }) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  const progress = useRef(new Animated.Value(ratio)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: ratio,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, ratio]);

  return (
    <View style={styles.track}>
      <Animated.View
        style={[
          styles.fill,
          {
            width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          },
        ]}
      />
    </View>
  );
}

/** Fila de tarea: se marca con muelle y desaparece deslizándose al quitarla. */
export function TaskRow({
  task,
  onToggle,
  onRemove,
  onToggleAlarm,
  onToggleMute,
  busy = false,
}: {
  task: Task;
  onToggle: () => void;
  onRemove: () => void;
  onToggleAlarm?: () => void;
  onToggleMute?: () => void;
  busy?: boolean;
}) {
  const exit = useRef(new Animated.Value(0)).current;

  const remove = () => {
    Animated.timing(exit, {
      toValue: 1,
      duration: 180,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onRemove();
    });
  };

  const alarmSelected = task.alarmStatus === 'scheduled'
    || task.alarmStatus === 'scheduling'
    || task.alarmStatus === 'fired';

  return (
    <Animated.View
      style={[
        styles.row,
        {
          opacity: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: [
            { translateX: exit.interpolate({ inputRange: [0, 1], outputRange: [0, 26] }) },
            { scaleY: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0.7] }) },
          ],
        },
      ]}
    >
      <Checkbox
        checked={task.done}
        onToggle={onToggle}
        accessibilityLabel={`${task.done ? 'Desmarcar' : 'Marcar'} ${task.title}`}
      />
      <View style={styles.rowText}>
        <Text style={[typography.body, task.done && styles.done]} numberOfLines={1}>{task.title}</Text>
        <Text style={typography.labelOnNote}>{taskMetaLabel(task)}</Text>
      </View>
      {!task.done ? (
        <Chip
          label={alarmChipLabel(task)}
          selected={alarmSelected}
          onPress={busy ? undefined : onToggleAlarm}
          accessibilityLabel={`${alarmChipLabel(task)}: ${task.title}`}
        />
      ) : null}
      {!busy && !task.done && task.alarmEnabled && onToggleMute ? (
        <PressableScale
          onPress={onToggleMute}
          accessibilityLabel={task.alarmMode === 'NOTIFICATION'
            ? `Activar sonido para ${task.title}`
            : `Silenciar aviso de ${task.title}`}
          style={styles.alarmMode}
        >
          <Icon
            name={task.alarmMode === 'NOTIFICATION' ? 'bell-off' : 'bell'}
            size={14}
            color={colors.noteLabel}
          />
        </PressableScale>
      ) : null}
      <PressableScale onPress={remove} accessibilityLabel={`Quitar ${task.title}`} style={styles.delete}>
        <Icon name="x" size={16} color={colors.noteLabel} />
      </PressableScale>
    </Animated.View>
  );
}

/** Fila de gasto: el estado se alterna tocando el chip. */
export function ExpenseRow({
  expense,
  onToggleSettled,
}: {
  expense: Expense;
  onToggleSettled: () => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={[typography.body, expense.settled && styles.done]} numberOfLines={1}>
          {expense.title}
        </Text>
        <Text style={typography.labelOnNote}>{expense.settled ? 'Pagado' : 'Pendiente'}</Text>
      </View>
      <Text style={[typography.bodyStrong, expense.settled && styles.done, tabularNums]}>
        {formatEuros(expense.amountCents)}
      </Text>
      <Chip
        label={expense.settled ? 'Pagado' : 'Pagar'}
        selected={expense.settled}
        onPress={onToggleSettled}
        accessibilityLabel={`${expense.settled ? 'Marcar como pendiente' : 'Marcar como pagado'} ${expense.title}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.noteTrack,
    overflow: 'hidden',
    marginTop: 4,
  },
  fill: {
    height: 6,
    backgroundColor: colors.ntx,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.noteLine,
    paddingVertical: 2,
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
  done: {
    color: colors.noteLabel,
    textDecorationLine: 'line-through',
  },
  delete: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alarmMode: {
    width: 24,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
