/**
 * P6 · Publicación del snapshot en el widget instalado.
 *
 * Es el único punto que habla con `expo-widgets`. La app lo llama tras
 * reconciliar (P5) o tras una decisión confirmada; nunca desde el render del widget.
 *
 * No promete refresco inmediato: `updateSnapshot` actualiza cuando el proceso de
 * la app puede ejecutarlo. Si la app está cerrada, el launcher sigue mostrando la
 * última publicación y su marca de tiempo.
 */
import AlarmaTWidget from './AlarmaTWidget.tsx';
import AlarmaTAlarmsWidget from './AlarmaTAlarmsWidget.tsx';
import AlarmaTTasksWidget from './AlarmaTTasksWidget.tsx';
import { adoptSnapshotForSession, createSignedOutWidgetSnapshot, type WidgetSnapshot } from './snapshot.ts';
import { toWidgetProps, type WidgetViewModelOptions } from './viewModel.ts';

export type WidgetPublishResult =
  | { readonly published: true }
  | { readonly published: false; readonly reason: 'unsupported_platform' | 'native_error' };

type WidgetSession = { readonly userId: string; readonly groupId: string } | null;

/** Attempt every provider, including on logout if one provider fails. */
function updateEveryWidget(actions: readonly (() => void)[]): WidgetPublishResult {
  let failure: WidgetPublishResult | null = null;
  for (const action of actions) {
    try { action(); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unsupported = /unavailable|not available|unsupported|ExpoWidgets/i.test(message);
      failure = { published: false, reason: unsupported ? 'unsupported_platform' : 'native_error' };
    }
  }
  return failure ?? { published: true };
}

function publish(snapshot: WidgetSnapshot, nowEpochMs: number, options?: WidgetViewModelOptions): WidgetPublishResult {
  const props = toWidgetProps(snapshot, nowEpochMs, options);
  return updateEveryWidget([
    () => AlarmaTWidget.updateSnapshot({ ...props, variant: 'board' }),
    () => AlarmaTAlarmsWidget.updateSnapshot({ ...props, variant: 'alarms' }),
    () => AlarmaTTasksWidget.updateSnapshot({ ...props, variant: 'tasks' }),
  ]);
}

/**
 * Publica solo si el snapshot pertenece a la sesión vigente. Al cerrar sesión o
 * cambiar de cuenta se publica el estado vacío y se descarta el contenido anterior.
 */
export function syncWidgetForSession(
  snapshot: WidgetSnapshot,
  session: WidgetSession,
  nowEpochMs: number,
  options?: WidgetViewModelOptions,
): WidgetPublishResult {
  return publish(adoptSnapshotForSession(snapshot, session, nowEpochMs), nowEpochMs, options);
}

/** Cierre de sesión: el widget no puede conservar títulos ni contadores privados. */
export function clearWidget(nowEpochMs: number): WidgetPublishResult {
  return publish(createSignedOutWidgetSnapshot(nowEpochMs), nowEpochMs);
}

/** Fuerza una relectura del widget (por ejemplo al volver a primer plano). */
export function reloadWidget(): WidgetPublishResult {
  return updateEveryWidget([
    () => AlarmaTWidget.reload(),
    () => AlarmaTAlarmsWidget.reload(),
    () => AlarmaTTasksWidget.reload(),
  ]);
}
