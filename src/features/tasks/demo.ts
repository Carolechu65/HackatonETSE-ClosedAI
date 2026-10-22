/**
 * P6 · Fixtures de demostración de tareas.
 *
 * **Datos simulados.** Se muestran con la etiqueta «demo» hasta que P5 conecte
 * `TaskRepository`. No representan miembros ni tareas reales de ningún grupo.
 */
import type { HouseholdTask, TaskMember } from './model.ts';

export const DEMO_MEMBERS: readonly TaskMember[] = [
  { uid: 'u-marta', status: 'active' },
  { uid: 'u-luis', status: 'active' },
  { uid: 'u-sofia', status: 'active' },
];

export const DEMO_MEMBER_NAMES: Readonly<Record<string, string>> = {
  'u-marta': 'Marta',
  'u-luis': 'Luis',
  'u-sofia': 'Sofía',
};

export const DEMO_GROUP_ID = 'piso-4b-demo';

export const DEMO_TASKS: readonly HouseholdTask[] = [
  {
    id: 'demo-task-1',
    groupId: DEMO_GROUP_ID,
    title: 'Sacar la basura',
    assigneeUid: 'u-luis',
    createdByUid: 'u-marta',
    activateAtEpochMs: null,
    dueAtEpochMs: null,
    status: 'pending',
    version: 1,
    completedByUid: null,
    completedAtEpochMs: null,
  },
  {
    id: 'demo-task-2',
    groupId: DEMO_GROUP_ID,
    title: 'Pagar la luz',
    assigneeUid: null,
    createdByUid: 'u-marta',
    activateAtEpochMs: null,
    dueAtEpochMs: Date.parse('2026-10-23T18:00:00.000Z'),
    status: 'pending',
    version: 2,
    completedByUid: null,
    completedAtEpochMs: null,
  },
  {
    id: 'demo-task-3',
    groupId: DEMO_GROUP_ID,
    title: 'Comprar café',
    assigneeUid: 'u-marta',
    createdByUid: 'u-sofia',
    activateAtEpochMs: null,
    dueAtEpochMs: null,
    status: 'completed',
    version: 3,
    completedByUid: 'u-marta',
    completedAtEpochMs: Date.parse('2026-10-21T10:15:00.000Z'),
  },
];

/** Compatibilidad con el scaffold: la primera tarea de ejemplo. */
export const demoTask = DEMO_TASKS[0]!;

export function demoMemberName(uid: string | null): string {
  if (uid === null) return 'Sin asignar';
  return DEMO_MEMBER_NAMES[uid] ?? 'Miembro del grupo';
}
