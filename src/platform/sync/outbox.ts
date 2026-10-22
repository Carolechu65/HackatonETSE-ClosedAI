import { DomainError, isRetryableError } from '../../domain/errors.ts';
import type { Clock } from '../../domain/alarms.ts';
import type { AlarmGateway } from '../../data/model.ts';
import { LocalStore } from '../../data/local/store.ts';

export { type PendingOperation } from '../../data/model.ts';

/** One sender per account; claims are also transactional in SQLite. */
export class OutboxWorker {
  private flight: Promise<void> | undefined;
  private readonly options: {
    userId: string; store: LocalStore; gateway: AlarmGateway; clock: Clock;
    assertCurrent(): void; random?: () => number; maxAttempts?: number; batchSize?: number;
  };
  constructor(options: OutboxWorker['options']) { this.options = options; }

  flush(): Promise<void> {
    if (this.flight) return this.flight;
    this.flight = this.drain().finally(() => { this.flight = undefined; });
    return this.flight;
  }

  private async drain(): Promise<void> {
    const { userId, store, gateway, clock, assertCurrent } = this.options;
    for (let index = 0; index < (this.options.batchSize ?? 50); index++) {
      assertCurrent();
      const item = await store.claim(userId, clock.nowEpochMs());
      if (!item) return;
      try {
        if (!await store.canSendOperation(userId, item.operationId)) continue;
        assertCurrent();
        const receipt = await gateway.execute(item.kind, item.command);
        assertCurrent();
        if (receipt.operationId !== item.operationId) throw new DomainError('INVALID_ARGUMENT', 'Acuse de otra operación.');
        await store.settle(userId, item.operationId, 'CONFIRMED', { receipt });
      } catch (error) {
        // A switched/expired session must never confirm an old request, even if fetch ignored abort.
        let current = true;
        try { assertCurrent(); } catch { current = false; }
        const code = error instanceof DomainError ? error.code : 'TEMPORARY_UNAVAILABLE';
        if (!current || code === 'UNAUTHENTICATED') {
          await store.settle(userId, item.operationId, 'QUEUED', { errorCode: 'UNAUTHENTICATED' });
          throw new DomainError('UNAUTHENTICATED', 'Vuelve a iniciar sesión para enviar los cambios pendientes.');
        }
        const retryable = isRetryableError(code) && item.attempts < (this.options.maxAttempts ?? 8);
        const jitter = 0.5 + Math.max(0, Math.min(1, (this.options.random ?? Math.random)()));
        const delay = Math.min(300_000, 1000 * 2 ** Math.min(item.attempts - 1, 9)) * jitter;
        const retryAfter = error instanceof DomainError && typeof error.details?.retryAfterMs === 'number'
          ? Math.min(3_600_000, Math.max(0, error.details.retryAfterMs)) : 0;
        await store.settle(userId, item.operationId, code === 'VERSION_CONFLICT' ? 'CONFLICT' : retryable ? 'QUEUED' : 'FAILED_PERMANENT', {
          errorCode: code, nextAttemptAt: clock.nowEpochMs() + Math.max(delay, retryAfter),
        });
      }
    }
  }
}
