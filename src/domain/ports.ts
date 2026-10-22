/**
 * Puertos que la UI consume. La implementación real (SQLite + RNFirebase) es de P5;
 * los fakes de `src/domain/fakes.ts` permiten trabajar sin backend.
 */
import type { AlarmSummary } from './alarms.ts';
import type { AlarmCommand, OperationReceipt } from './contracts/types.ts';

export type ReconcileResult = {
  checkedAtEpochMs: number;
  pendingCommands: number;
  conflicts: number;
  repairedSchedules: number;
};

export interface AlarmRepository {
  subscribeInbox(onChange: (items: readonly AlarmSummary[]) => void): () => void;
  submit(command: AlarmCommand): Promise<OperationReceipt>;
  reconcile(): Promise<ReconcileResult>;
}
