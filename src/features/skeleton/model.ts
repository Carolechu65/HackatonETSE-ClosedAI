/**
 * Estado del esqueleto interactivo de P1.
 *
 * Vive en memoria: sirve para probar la navegación, los estados y las animaciones
 * sin backend. P5 lo sustituirá por SQLite + repositorio; ningún dato de aquí se
 * presenta como sincronizado ni como alarma programada.
 */

export type Task = {
  id: string;
  title: string;
  time: string;
  done: boolean;
};

export type Expense = {
  id: string;
  title: string;
  amountCents: number;
  settled: boolean;
};

export type Member = {
  id: string;
  name: string;
  initial: string;
  present: boolean;
};

export type Preferences = {
  proposals: boolean;
  acceptedReminders: boolean;
};

export type SkeletonState = {
  tasks: Task[];
  expenses: Expense[];
  members: Member[];
  preferences: Preferences;
  nextId: number;
};

export const initialSkeletonState: SkeletonState = {
  tasks: [
    { id: 'task-1', title: 'Sacar la basura', time: '21:00', done: false },
    { id: 'task-2', title: 'Fregar los platos', time: '22:00', done: false },
    { id: 'task-3', title: 'Comprar detergente', time: 'mañana', done: false },
    { id: 'task-4', title: 'Bajar el cartón', time: 'lunes', done: true },
  ],
  expenses: [
    { id: 'expense-1', title: 'Factura de la luz', amountCents: 8420, settled: false },
    { id: 'expense-2', title: 'Compra semanal', amountCents: 3210, settled: true },
    { id: 'expense-3', title: 'Internet', amountCents: 2990, settled: false },
  ],
  members: [
    { id: 'member-1', name: 'Luis', initial: 'L', present: true },
    { id: 'member-2', name: 'Ana', initial: 'A', present: true },
    { id: 'member-3', name: 'Dani', initial: 'D', present: true },
    { id: 'member-4', name: 'Carla', initial: 'C', present: false },
  ],
  preferences: { proposals: true, acceptedReminders: true },
  nextId: 5,
};

export type SkeletonAction =
  | { type: 'task/add'; title: string }
  | { type: 'task/toggle'; id: string }
  | { type: 'task/remove'; id: string }
  | { type: 'expense/add'; title: string; amountCents: number }
  | { type: 'expense/toggleSettled'; id: string }
  | { type: 'expense/remove'; id: string }
  | { type: 'member/togglePresent'; id: string }
  | { type: 'preferences/toggle'; key: keyof Preferences };

const MAX_TASKS = 6;
const MAX_TITLE_LENGTH = 80;

export function skeletonReducer(state: SkeletonState, action: SkeletonAction): SkeletonState {
  switch (action.type) {
    case 'task/add': {
      const title = action.title.trim().slice(0, MAX_TITLE_LENGTH);
      if (title.length === 0) return state;
      if (state.tasks.length >= MAX_TASKS) return state;
      return {
        ...state,
        nextId: state.nextId + 1,
        tasks: [{ id: `task-${state.nextId}`, title, time: 'hoy', done: false }, ...state.tasks],
      };
    }
    case 'task/toggle':
      return {
        ...state,
        tasks: state.tasks.map((task) => (task.id === action.id ? { ...task, done: !task.done } : task)),
      };
    case 'task/remove':
      return { ...state, tasks: state.tasks.filter((task) => task.id !== action.id) };
    case 'expense/add': {
      const title = action.title.trim().slice(0, MAX_TITLE_LENGTH);
      if (title.length === 0 || action.amountCents <= 0) return state;
      return {
        ...state,
        nextId: state.nextId + 1,
        expenses: [
          { id: `expense-${state.nextId}`, title, amountCents: Math.round(action.amountCents), settled: false },
          ...state.expenses,
        ],
      };
    }
    case 'expense/toggleSettled':
      return {
        ...state,
        expenses: state.expenses.map((expense) => (
          expense.id === action.id ? { ...expense, settled: !expense.settled } : expense
        )),
      };
    case 'expense/remove':
      return { ...state, expenses: state.expenses.filter((expense) => expense.id !== action.id) };
    case 'member/togglePresent':
      return {
        ...state,
        members: state.members.map((member) => (
          member.id === action.id ? { ...member, present: !member.present } : member
        )),
      };
    case 'preferences/toggle':
      return {
        ...state,
        preferences: { ...state.preferences, [action.key]: !state.preferences[action.key] },
      };
    default:
      return state;
  }
}

export function pendingTasks(state: SkeletonState): Task[] {
  return state.tasks.filter((task) => !task.done);
}

export function completedTaskCount(state: SkeletonState): number {
  return state.tasks.length - pendingTasks(state).length;
}

export function nextTask(state: SkeletonState): Task | null {
  return [...state.tasks]
    .filter((task) => !task.done)
    .sort((a, b) => a.time.localeCompare(b.time))[0] ?? null;
}

export function unsettledTotalCents(state: SkeletonState): number {
  return state.expenses.filter((expense) => !expense.settled).reduce((total, expense) => total + expense.amountCents, 0);
}

export function settledTotalCents(state: SkeletonState): number {
  return state.expenses.filter((expense) => expense.settled).reduce((total, expense) => total + expense.amountCents, 0);
}

export function presentMemberCount(state: SkeletonState): number {
  return state.members.filter((member) => member.present).length;
}

/** Reparto informativo; el cálculo contable real es de P1/expenses con tests propios. */
export function perPersonCents(state: SkeletonState): number {
  const people = Math.max(1, presentMemberCount(state));
  return Math.round(unsettledTotalCents(state) / people);
}

/** Formato español: `84,20 €`, coma decimal y símbolo separado. */
export function formatEuros(cents: number): string {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? '-' : '';
  const absolute = Math.abs(rounded);
  const units = Math.floor(absolute / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimals = String(absolute % 100).padStart(2, '0');
  return `${sign}${units},${decimals} €`;
}

/**
 * Acepta `12`, `12,5`, `12.50` o `1.234,56` y devuelve céntimos.
 * Con solo puntos, `1.234` se interpreta como miles y `12.50` como decimales.
 */
export function parseEuros(input: string): number | null {
  const cleaned = input.trim().replace(/\s|€/g, '').replace(/[^\d.,]/g, '');
  if (cleaned.length === 0) return null;

  let normalized: string;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, '');
  } else {
    normalized = cleaned;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}
