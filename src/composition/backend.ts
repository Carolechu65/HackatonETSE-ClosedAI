import type { AlarmCommand, OperationReceipt } from '../domain/contracts/types.ts';
import type { ProductAlarm } from './product.ts';

/** One session and one transport, implemented by the P5 adapters. */
export interface ProductBackend {
  initialize(): Promise<void>;
  userId(): string | null;
  authenticate(input: { email: string; password: string; displayName?: string }, register: boolean): Promise<void>;
  logout(): Promise<void>;
  request(path: string, method?: 'GET' | 'POST', body?: unknown): Promise<unknown>;
  submit(command: AlarmCommand): Promise<OperationReceipt>;
  reconcile(): Promise<void>;
  decorate(alarms: ProductAlarm[]): ProductAlarm[];
  cached?(): { userId: string; alarms: ProductAlarm[]; lastSync: number | null };
  pending(): number;
  subscribe(listener: () => void): () => void;
  makePrimaryDevice(): Promise<string>;
  requestPermissions(): Promise<string>;
}
