/**
 * P6 · Frontera de autorización de la ruta `/task/[taskId]`.
 *
 * Abrir un enlace no concede acceso: sin sesión se pide acceso, y una tarea de
 * otro grupo se trata como inexistente (no se revela que existe). La sesión real
 * la aporta P2; aquí solo se decide qué puede pintarse.
 */
import type { HouseholdTask } from './model.ts';

export type TaskSession = {
  readonly userId: string;
  readonly groupIds: readonly string[];
} | null;

export type TaskAccess = 'ok' | 'sign_in_required' | 'not_found';

export function resolveTaskAccess(task: HouseholdTask | null, session: TaskSession): TaskAccess {
  if (session === null) return 'sign_in_required';
  if (task === null) return 'not_found';
  if (!session.groupIds.includes(task.groupId)) return 'not_found';
  return 'ok';
}
