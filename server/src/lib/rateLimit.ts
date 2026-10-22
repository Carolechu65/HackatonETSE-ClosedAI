import { DomainError } from '../../../src/domain/errors.ts';

/** Ventana fija en memoria. Un único proceso de aplicación; no es un límite distribuido. */
export class FixedWindowLimiter {
  private readonly buckets = new Map<string, { count: number; resetAtEpochMs: number }>();
  private lastSweepEpochMs = 0;

  constructor(private readonly max: number, private readonly windowMs: number) {}

  check(key: string, nowEpochMs = Date.now()): void {
    this.sweep(nowEpochMs);
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAtEpochMs <= nowEpochMs) {
      this.buckets.set(key, { count: 1, resetAtEpochMs: nowEpochMs + this.windowMs });
      return;
    }
    if (bucket.count >= this.max) {
      throw new DomainError('RATE_LIMITED', 'Demasiadas peticiones. Inténtalo de nuevo más tarde.', {
        retryAfterMs: bucket.resetAtEpochMs - nowEpochMs,
      });
    }
    bucket.count += 1;
  }

  reset(): void {
    this.buckets.clear();
  }

  private sweep(nowEpochMs: number): void {
    if (nowEpochMs - this.lastSweepEpochMs < this.windowMs) return;
    this.lastSweepEpochMs = nowEpochMs;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAtEpochMs <= nowEpochMs) this.buckets.delete(key);
    }
  }
}
