/**
 * P6 · Publicación real en Android/iOS. Metro elige este archivo por la extensión
 * `.native.ts`; en web se usa `publish.ts` para no importar `expo-widgets`.
 */
import {
  clearWidget as clearNative,
  reloadWidget as reloadNative,
  syncWidgetForSession as syncNative,
} from './publisher.ts';
import type { WidgetPublishResult, WidgetSession } from './publish.ts';
import type { WidgetSnapshot } from './snapshot.ts';
import type { WidgetViewModelOptions } from './viewModel.ts';

export type { WidgetPublishResult, WidgetSession } from './publish.ts';

export function syncWidgetForSession(
  snapshot: WidgetSnapshot,
  session: WidgetSession,
  nowEpochMs: number,
  options?: WidgetViewModelOptions,
): WidgetPublishResult {
  return syncNative(snapshot, session, nowEpochMs, options);
}

export function clearWidget(nowEpochMs: number): WidgetPublishResult {
  return clearNative(nowEpochMs);
}

export function reloadWidget(): WidgetPublishResult {
  return reloadNative();
}
