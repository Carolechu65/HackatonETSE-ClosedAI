import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';
import {
  initialSkeletonState,
  skeletonReducer,
  type Preferences,
  type SkeletonState,
} from './model.ts';

type SkeletonActions = {
  addTask(title: string): void;
  toggleTask(id: string): void;
  removeTask(id: string): void;
  addExpense(title: string, amountCents: number): void;
  toggleExpenseSettled(id: string): void;
  removeExpense(id: string): void;
  toggleMemberPresent(id: string): void;
  togglePreference(key: keyof Preferences): void;
};

type SkeletonContextValue = {
  state: SkeletonState;
  actions: SkeletonActions;
};

const SkeletonContext = createContext<SkeletonContextValue | null>(null);

/**
 * Estado compartido del esqueleto. Solo memoria: al recargar se pierden los cambios,
 * igual que en el prototipo de P5 antes de conectar SQLite.
 */
export function SkeletonProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(skeletonReducer, initialSkeletonState);
  const actions = useMemo<SkeletonActions>(() => ({
    addTask: (title) => dispatch({ type: 'task/add', title }),
    toggleTask: (id) => dispatch({ type: 'task/toggle', id }),
    removeTask: (id) => dispatch({ type: 'task/remove', id }),
    addExpense: (title, amountCents) => dispatch({ type: 'expense/add', title, amountCents }),
    toggleExpenseSettled: (id) => dispatch({ type: 'expense/toggleSettled', id }),
    removeExpense: (id) => dispatch({ type: 'expense/remove', id }),
    toggleMemberPresent: (id) => dispatch({ type: 'member/togglePresent', id }),
    togglePreference: (key) => dispatch({ type: 'preferences/toggle', key }),
  }), []);

  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <SkeletonContext.Provider value={value}>{children}</SkeletonContext.Provider>;
}

export function useSkeleton(): SkeletonContextValue {
  const value = useContext(SkeletonContext);
  if (!value) throw new Error('useSkeleton debe usarse dentro de <SkeletonProvider>.');
  return value;
}
