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
import { adoptSnapshotForSession, createSignedOutWidgetSnapshot, type WidgetSnapshot } from './snapshot.ts';
import { toWidgetProps, type WidgetViewModelOptions } from './viewModel.ts';

export type WidgetPublishResult =
  | { readonly published: true }
  | { readonly published: false; readonly reason: 'unsupported_platform' | 'native_error' };

type WidgetSession = { readonly userId: string; readonly groupId: string } | null;

function publish(snapshot: WidgetSnapshot, nowEpochMs: number, options?: WidgetViewModelOptions): WidgetPublishResult {
  try {
    AlarmaTWidget.updateSnapshot(toWidgetProps(snapshot, nowEpochMs, options));
    return { published: true };
  } catch (error) {
    // En web/Expo Go el módulo nativo no existe. No es un éxito: la UI no debe
    // afirmar que el widget se actualizó.
    const message = error instanceof Error ? error.message : String(error);
    const unsupported = /unavailable|not available|unsupported|ExpoWidgets/i.test(message);
    return { published: false, reason: unsupported ? 'unsupported_platform' : 'native_error' };
  }
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
  try {
    AlarmaTWidget.reload();
    return { published: true };
  } catch {
    return { published: false, reason: 'unsupported_platform' };
  }
}
