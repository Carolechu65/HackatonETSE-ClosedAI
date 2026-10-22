/** Push data is only a hint to fetch authorized state; never a scheduling command. */
export interface RemoteChangeHint { eventId: string; version?: number }

export function parseRemoteChangeHint(data: unknown): RemoteChangeHint | null {
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  if (typeof value.eventId !== 'string' || value.eventId.length === 0 || value.eventId.length > 256) return null;
  if (value.version !== undefined && (!Number.isSafeInteger(value.version) || (value.version as number) < 0)) return null;
  return { eventId: value.eventId, ...(value.version === undefined ? {} : { version: value.version as number }) };
}

/** Bounded, session-local optimization. Durable event deduplication belongs to the repository. */
export class RemoteHintDeduplicator {
  private readonly seen = new Set<string>();
  private readonly capacity: number;
  constructor(capacity = 256) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Invalid hint capacity');
    this.capacity = capacity;
  }
  accept(hint: RemoteChangeHint): boolean {
    const key = JSON.stringify([hint.eventId, hint.version ?? null]);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > this.capacity) this.seen.delete(this.seen.values().next().value!);
    return true;
  }
  clear(): void { this.seen.clear(); }
}
