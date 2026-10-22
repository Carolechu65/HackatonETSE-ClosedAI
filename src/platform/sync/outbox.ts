/** P5: persistir en SQLite antes de enviar; P3 valida idempotencia en servidor. */
export interface PendingCommand {
  operationId: string;
  alarmId: string;
  expectedVersion: number;
  kind: 'accept' | 'reject';
  createdAt: string;
  attempts: number;
}

/** Puerto inicial: no hay envío, persistencia ni reintentos implementados. */
export interface Outbox {
  enqueue(command: PendingCommand): Promise<void>;
  listPending(): Promise<readonly PendingCommand[]>;
  markAcknowledged(operationId: string): Promise<void>;
}
