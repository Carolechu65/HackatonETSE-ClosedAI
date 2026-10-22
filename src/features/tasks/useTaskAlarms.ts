import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { alarmRuntime, type AlarmCapabilities } from '../../platform/alarms/index.ts';
import type { Task } from '../skeleton/model.ts';
import { useSkeleton } from '../skeleton/store.tsx';
import { buildTaskOccurrence, occurrenceKeyFromTask } from './taskAlarms.ts';
import { formatReminderLabel, reminderAt, resolveDueAt } from './taskTime.ts';

export const PERMISSION_TASK_ID = 'permissions';

const UNAVAILABLE_CAPABILITIES: AlarmCapabilities = {
  available: false,
  exactAlarms: false,
  audibleAlarms: false,
  notifications: false,
  fullScreenIntent: false,
  reason: 'E_NOT_AVAILABLE',
};

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo actualizar la alarma.';
}

/**
 * Controlador de alarmas de tareas.
 *
 * Mantiene el estado de permiso/capacidades fuera del reducer puro y escribe en
 * el store de la app solo el resultado observable de cada operación. La alarma
 * real vive en `modules/alarm-runtime`; este hook no simula `SCHEDULED`.
 */
export function useTaskAlarms() {
  const { state, actions } = useSkeleton();
  const [capabilities, setCapabilities] = useState<AlarmCapabilities | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const hydrated = useRef(false);

  const refreshCapabilities = useCallback(async () => {
    try {
      const next = await alarmRuntime.getCapabilities();
      setCapabilities(next);
      return next;
    } catch {
      setCapabilities(UNAVAILABLE_CAPABILITIES);
      return UNAVAILABLE_CAPABILITIES;
    }
  }, []);

  useEffect(() => {
    void refreshCapabilities();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void refreshCapabilities();
    });
    return () => subscription.remove();
  }, [refreshCapabilities]);

  // Al abrir la app, refleja alarmas que ya existían en el store nativo. Las
  // tareas del esqueleto viven en memoria; el runtime es quien conserva la alarma.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    void (async () => {
      try {
        const snapshot = await alarmRuntime.getSnapshot();
        if (!snapshot.available) return;
        for (const occurrence of snapshot.occurrences) {
          if (!occurrence.spec.requestId.startsWith('task:')) continue;
          const taskId = occurrence.spec.requestId.slice('task:'.length);
          if (!state.tasks.some((task) => task.id === taskId)) continue;
          const prefix = `task:${taskId}:`;
          const dueAt = occurrence.spec.occurrenceId.startsWith(prefix)
            ? occurrence.spec.occurrenceId.slice(prefix.length)
            : null;

          if (occurrence.status === 'SCHEDULED') {
            actions.setTaskAlarm(taskId, {
              alarmEnabled: true,
              alarmStatus: 'scheduled',
              alarmReason: null,
              dueAt,
            });
          } else if (occurrence.status === 'SCHEDULING') {
            actions.setTaskAlarm(taskId, {
              alarmEnabled: true,
              alarmStatus: 'scheduling',
              alarmReason: null,
              dueAt,
            });
          } else if (occurrence.status === 'FIRED') {
            const dismissed = occurrence.dismissedAtEpochMs != null;
            actions.setTaskAlarm(taskId, {
              alarmEnabled: false,
              alarmStatus: dismissed ? 'off' : 'fired',
              alarmReason: null,
              dueAt: dismissed ? null : dueAt,
            });
          } else if (occurrence.status === 'FAILED') {
            const pendingPermission = occurrence.failureReason === 'E_EXACT_ALARM_PERMISSION'
              || occurrence.failureReason === 'E_NOTIFICATION_PERMISSION';
            actions.setTaskAlarm(taskId, {
              alarmEnabled: false,
              alarmStatus: pendingPermission ? 'pending_permission' : 'failed',
              alarmReason: occurrence.failureReason ?? 'E_RUNTIME',
              dueAt,
            });
          } else if (occurrence.status === 'CANCELLED' || occurrence.status === 'EXPIRED') {
            actions.setTaskAlarm(taskId, {
              alarmEnabled: false,
              alarmStatus: 'off',
              alarmReason: null,
              dueAt: null,
            });
          }
        }
      } catch {
        // El snapshot es una mejora de recuperación; si falla, la app sigue usable.
      }
    })();
  }, [actions, state.tasks]);

  const schedule = useCallback(async (
    task: Task,
    mode: Task['alarmMode'] = task.alarmMode,
  ) => {
    if (busyTaskId) return;
    if (task.done) {
      setMessage('Marca la tarea como pendiente antes de programar un aviso.');
      return;
    }
    setBusyTaskId(task.id);
    setMessage(null);

    try {
      const caps = await refreshCapabilities();
      if (!caps.available) {
        actions.setTaskAlarm(task.id, {
          alarmEnabled: false,
          alarmStatus: 'failed',
          alarmReason: 'E_NOT_AVAILABLE',
        });
        setMessage('El módulo de alarmas no está instalado. Usa una development build Android.');
        return;
      }

      const dueAt = resolveDueAt(task.time);
      if (!dueAt) {
        actions.setTaskAlarm(task.id, {
          alarmEnabled: false,
          alarmStatus: 'failed',
          alarmReason: 'E_TIME',
        });
        setMessage('No se entiende la hora. Usa 21:00, mañana, hoy o un día de la semana.');
        return;
      }

      const occurrence = buildTaskOccurrence(task, dueAt, mode);
      actions.setTaskAlarm(task.id, {
        alarmEnabled: true,
        alarmMode: mode,
        alarmStatus: 'scheduling',
        alarmReason: null,
        dueAt: dueAt.toISOString(),
      });

      const result = await alarmRuntime.schedule(occurrence);
      if (result.status === 'SCHEDULED') {
        actions.setTaskAlarm(task.id, {
          alarmEnabled: true,
          alarmStatus: 'scheduled',
          alarmReason: null,
          dueAt: dueAt.toISOString(),
        });
        const reminder = reminderAt(dueAt, task.priority);
        setMessage(`Aviso de «${task.title}» programado para ${formatReminderLabel(reminder)}.`);
        return;
      }

      if (result.status === 'PENDING_PERMISSION') {
        actions.setTaskAlarm(task.id, {
          alarmEnabled: false,
          alarmStatus: 'pending_permission',
          alarmReason: result.reason,
          dueAt: dueAt.toISOString(),
        });
        setMessage('Aceptada, pero no programada: faltan permisos de alarma exacta o notificaciones.');
        return;
      }

      actions.setTaskAlarm(task.id, {
        alarmEnabled: false,
        alarmStatus: 'failed',
        alarmReason: result.reason,
        dueAt: dueAt.toISOString(),
      });
      setMessage(`No se pudo programar el aviso: ${result.reason}`);
    } catch (error) {
      actions.setTaskAlarm(task.id, {
        alarmEnabled: false,
        alarmStatus: 'failed',
        alarmReason: toMessage(error),
      });
      setMessage(toMessage(error));
    } finally {
      setBusyTaskId(null);
    }
  }, [actions, busyTaskId, refreshCapabilities]);

  const cancel = useCallback(async (task: Task): Promise<boolean> => {
    if (busyTaskId) return false;
    setBusyTaskId(task.id);
    setMessage(null);
    try {
      const key = occurrenceKeyFromTask(task);
      if (key) await alarmRuntime.cancel(key);
      actions.setTaskAlarm(task.id, {
        alarmEnabled: false,
        alarmStatus: 'off',
        alarmReason: null,
        dueAt: null,
      });
      setMessage(`Aviso de «${task.title}» retirado.`);
      return true;
    } catch (error) {
      setMessage(toMessage(error));
      return false;
    } finally {
      setBusyTaskId(null);
    }
  }, [actions, busyTaskId]);

  const stop = useCallback(async (task: Task) => {
    if (busyTaskId) return;
    const key = occurrenceKeyFromTask(task);
    if (!key) {
      actions.setTaskAlarm(task.id, { alarmEnabled: false, alarmStatus: 'off', alarmReason: null });
      return;
    }
    setBusyTaskId(task.id);
    setMessage(null);
    try {
      await alarmRuntime.stop(key);
      actions.setTaskAlarm(task.id, {
        alarmEnabled: false,
        alarmStatus: 'off',
        alarmReason: null,
        dueAt: null,
      });
      setMessage(`Alarma de «${task.title}» detenida.`);
    } catch (error) {
      setMessage(toMessage(error));
    } finally {
      setBusyTaskId(null);
    }
  }, [actions, busyTaskId]);

  const snooze = useCallback(async (task: Task) => {
    if (busyTaskId) return;
    const key = occurrenceKeyFromTask(task);
    if (!key) {
      setMessage('La tarea no tiene una alarma programada que posponer.');
      return;
    }
    setBusyTaskId(task.id);
    setMessage(null);
    try {
      const result = await alarmRuntime.snooze(key, 5);
      if (result.status === 'SCHEDULED') {
        actions.setTaskAlarm(task.id, {
          alarmEnabled: true,
          alarmStatus: 'scheduled',
          alarmReason: null,
        });
        setMessage(`Alarma de «${task.title}» pospuesta 5 minutos.`);
        return;
      }
      actions.setTaskAlarm(task.id, {
        alarmEnabled: false,
        alarmStatus: result.status === 'PENDING_PERMISSION' ? 'pending_permission' : 'failed',
        alarmReason: result.reason ?? result.status,
      });
      setMessage(`No se pudo posponer: ${result.reason ?? result.status}`);
    } catch (error) {
      setMessage(toMessage(error));
    } finally {
      setBusyTaskId(null);
    }
  }, [actions, busyTaskId]);

  const requestPermissions = useCallback(async () => {
    if (busyTaskId) return;
    setBusyTaskId(PERMISSION_TASK_ID);
    setMessage(null);
    try {
      const caps = await refreshCapabilities();
      if (!caps.available) {
        setMessage('Las alarmas reales requieren una development build Android.');
        return;
      }
      if (!caps.exactAlarms) {
        await alarmRuntime.requestExactAlarmPermission();
        setMessage('Concede «Alarmas y recordatorios» y vuelve a la app para programar el aviso.');
        return;
      }
      if (!caps.notifications) {
        await alarmRuntime.requestNotificationPermission();
        setMessage('Concede las notificaciones y vuelve a la app para programar el aviso.');
        return;
      }
      setMessage('Los permisos de alarma ya están concedidos. Toca «Aviso» en una tarea.');
    } catch (error) {
      setMessage(toMessage(error));
    } finally {
      setBusyTaskId(null);
    }
  }, [busyTaskId, refreshCapabilities]);

  const toggleAlarm = useCallback((task: Task) => {
    if (task.alarmStatus === 'fired') return stop(task);
    if (task.alarmStatus === 'pending_permission') return requestPermissions();
    if (task.alarmEnabled || task.alarmStatus === 'scheduled' || task.alarmStatus === 'scheduling') {
      return cancel(task);
    }
    return schedule(task);
  }, [cancel, requestPermissions, schedule, stop]);

  const toggleMute = useCallback((task: Task) => {
    const mode: Task['alarmMode'] = task.alarmMode === 'ALARM' ? 'NOTIFICATION' : 'ALARM';
    if (task.alarmEnabled || task.alarmStatus === 'scheduled' || task.alarmStatus === 'scheduling') {
      return schedule(task, mode);
    }
    actions.setTaskAlarm(task.id, { alarmMode: mode });
    setMessage(mode === 'NOTIFICATION'
      ? 'El próximo aviso de esta tarea será silencioso.'
      : 'El próximo aviso de esta tarea sonará como alarma.');
    return undefined;
  }, [actions, schedule]);

  const toggleTask = useCallback(async (task: Task) => {
    if (!task.done) {
      if (task.alarmStatus === 'fired') {
        await stop(task);
      } else if (task.alarmEnabled || task.alarmStatus === 'scheduled' || task.alarmStatus === 'scheduling') {
        const cancelled = await cancel(task);
        if (!cancelled) return;
      }
    }
    actions.toggleTask(task.id);
  }, [actions, cancel, stop]);

  const removeTask = useCallback(async (task: Task) => {
    if (task.alarmStatus === 'fired') {
      await stop(task);
    } else if (task.alarmEnabled || task.alarmStatus === 'scheduled' || task.alarmStatus === 'scheduling') {
      const cancelled = await cancel(task);
      if (!cancelled) return;
    }
    actions.removeTask(task.id);
  }, [actions, cancel, stop]);

  return {
    capabilities,
    busyTaskId,
    message,
    clearMessage: () => setMessage(null),
    refreshCapabilities,
    requestPermissions,
    toggleAlarm,
    toggleMute,
    stopAlarm: stop,
    snoozeAlarm: snooze,
    toggleTask,
    removeTask,
    tasks: state.tasks,
  };
}
