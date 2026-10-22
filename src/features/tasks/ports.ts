/**
 * P6 · Puertos de tareas.
 *
 * La UI no escribe en Firestore ni conoce el outbox. P5 implementa
 * `TaskRepository` sobre SQLite + operaciones de P3; mientras tanto existe un
 * fake en memoria para la demo, siempre etiquetado como tal.
 */
import type { OperationReceipt } from '../../domain/contracts/types.ts';
import type { HouseholdTask, TaskDraft } from './model.ts';

export type CreateTaskCommand = {
  readonly kind: 'createTask';
  readonly operationId: string;
  readonly groupId: string;
  readonly draft: TaskDraft;
};

export type CompleteTaskCommand = {
  readonly kind: 'completeTask';
  readonly operationId: string;
  readonly groupId: string;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly completedAtEpochMs: number;
};

export type ReopenTaskCommand = {
  readonly kind: 'reopenTask';
  readonly operationId: string;
  readonly groupId: string;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly reopenedAtEpochMs: number;
};

export type CancelTaskCommand = {
  readonly kind: 'cancelTask';
  readonly operationId: string;
  readonly groupId: string;
  readonly taskId: string;
  readonly expectedVersion: number;
  readonly cancelledAtEpochMs: number;
};

/**
 * Comandos propuestos a P3. No están en `contracts/` todavía: P3 debe crear los
 * esquemas `createTask`/`completeTask`/`cancelTask` y devolver `OperationReceipt`.
 * Las tareas comparten sobre idempotente con las alarmas (`operationId` + versión).
 */
export type TaskCommand = CreateTaskCommand | CompleteTaskCommand | ReopenTaskCommand | CancelTaskCommand;

export interface TaskRepository {
  subscribeTasks(groupId: string, onChange: (tasks: readonly HouseholdTask[]) => void): () => void;
  submit(command: TaskCommand): Promise<OperationReceipt>;
}
