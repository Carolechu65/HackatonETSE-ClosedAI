/**
 * P6 · Fachada de publicación del widget, segura en web.
 *
 * `publish.native.ts` (Android/iOS) habla con `expo-widgets`; este archivo es el
 * fallback de TypeScript y el que usa Metro en web, donde no existe widget nativo.
 * Nunca devuelve `published: true` si no se publicó de verdad.
 */
import type { WidgetSnapshot } from './snapshot.ts';
import type { WidgetViewModelOptions } from './viewModel.ts';

export type WidgetPublishResult =
  | { readonly published: true }
  | { readonly published: false; readonly reason: 'unsupported_platform' | 'native_error' };

export type WidgetSession = { readonly userId: string; readonly groupId: string } | null;

export function syncWidgetForSession(
  _snapshot: WidgetSnapshot,
  _session: WidgetSession,
  _nowEpochMs: number,
  _options?: WidgetViewModelOptions,
): WidgetPublishResult {
  return { published: false, reason: 'unsupported_platform' };
}

export function clearWidget(_nowEpochMs: number): WidgetPublishResult {
  return { published: false, reason: 'unsupported_platform' };
}

export function reloadWidget(): WidgetPublishResult {
  return { published: false, reason: 'unsupported_platform' };
}
