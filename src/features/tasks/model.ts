/** P6: añadir persistencia y comandos de completar/cancelar con P3/P5. */
export interface HouseholdTask {
  id: string;
  title: string;
  assignedTo: string;
  activateAt: string | null;
  dueAt: string | null;
  status: 'pending' | 'completed' | 'cancelled';
}

export const demoTask: HouseholdTask = {
  id: 'demo-task-1',
  title: 'Sacar la basura',
  assignedTo: 'Tú · demo',
  activateAt: null,
  dueAt: null,
  status: 'pending',
};
