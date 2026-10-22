import type { Clock } from '../../domain/alarms.ts';
import { DomainError } from '../../domain/errors.ts';
import { SerialQueue } from '../model.ts';

export interface SecureStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}
export type AuthSession = { userId: string; token: string; expiresAtEpochMs: number };
export type SessionView = { userId: string; authenticated: boolean; expiresAtEpochMs: number } | null;
export type SessionLease = { userId: string; token: string; signal: AbortSignal; assertCurrent(): void };
export type SessionGuard = { signal: AbortSignal; assertCurrent(): void };
const KEY = 'alarmat.session.v1';

export function validateSession(value: AuthSession, now: number): AuthSession {
  if (!value || typeof value.userId !== 'string' || !/^[A-Za-z0-9_:.-]{1,128}$/.test(value.userId)
    || typeof value.token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(value.token)
    || !Number.isSafeInteger(value.expiresAtEpochMs) || value.expiresAtEpochMs <= now) {
    throw new DomainError('UNAUTHENTICATED', 'La sesión no es válida o ha caducado.');
  }
  return { userId: value.userId, token: value.token, expiresAtEpochMs: value.expiresAtEpochMs };
}

/** The secret is only kept in memory/SecureStore. No token in observers or SQLite. */
export class SessionManager {
  private session: AuthSession | null = null;
  private expiredUser: string | null = null;
  private generation = 0;
  private controller = new AbortController();
  private readonly writes = new SerialQueue();
  private readonly listeners = new Set<(view: SessionView) => void>();
  private readonly storage: SecureStorage;
  private readonly clock: Clock;
  constructor(storage: SecureStorage, clock: Clock) { this.storage = storage; this.clock = clock; }

  view(): SessionView {
    if (this.session) return { userId: this.session.userId, expiresAtEpochMs: this.session.expiresAtEpochMs,
      authenticated: this.session.expiresAtEpochMs > this.clock.nowEpochMs() };
    return this.expiredUser ? { userId: this.expiredUser, authenticated: false, expiresAtEpochMs: 0 } : null;
  }
  subscribe(listener: (view: SessionView) => void): () => void {
    this.listeners.add(listener); listener(this.view());
    return () => { this.listeners.delete(listener); };
  }
  private emit(): void { for (const listener of this.listeners) { try { listener(this.view()); } catch { /* Observers cannot undo durable session transitions. */ } } }
  private rotate(): number { this.controller.abort(); this.controller = new AbortController(); return ++this.generation; }

  /** Guards anonymous login/restore work too, without exposing a bearer token. */
  guard(): SessionGuard {
    const generation = this.generation;
    return { signal: this.controller.signal, assertCurrent: () => {
      if (generation !== this.generation) throw new DomainError('UNAUTHENTICATED', 'La sesión ha cambiado.');
    } };
  }

  /** Abort old HTTP leases while retaining the bearer for coordinated remote logout. */
  cancelRequests(): void { this.rotate(); }

  async restore(): Promise<void> {
    const generation = this.generation;
    await this.writes.run(async () => {
      const encoded = await this.storage.getItemAsync(KEY);
      if (!encoded || generation !== this.generation) return;
      try {
        const parsed = JSON.parse(encoded) as AuthSession;
        if (typeof parsed?.userId === 'string' && /^[A-Za-z0-9_:.-]{1,128}$/.test(parsed.userId)) this.expiredUser = parsed.userId;
        this.session = validateSession(parsed, this.clock.nowEpochMs());
      } catch { this.session = null; await this.storage.deleteItemAsync(KEY); }
      if (generation !== this.generation) return;
      this.rotate(); this.emit();
    });
  }

  async install(value: AuthSession): Promise<void> {
    const session = validateSession(value, this.clock.nowEpochMs());
    const owner = this.view()?.userId;
    if (owner && owner !== session.userId) throw new DomainError('FORBIDDEN', 'Cierra la sesión anterior y cancela sus avisos antes de cambiar de cuenta.');
    const generation = this.rotate();
    this.session = null; this.expiredUser = session.userId; this.emit();
    await this.writes.run(async () => {
      if (generation !== this.generation) throw new DomainError('UNAUTHENTICATED', 'La sesión ha cambiado.');
      await this.storage.setItemAsync(KEY, JSON.stringify(session));
      if (generation !== this.generation) throw new DomainError('UNAUTHENTICATED', 'La sesión ha cambiado.');
      this.session = session; this.expiredUser = null; this.emit();
    });
  }

  lease(): SessionLease {
    const session = this.session;
    if (!session || session.expiresAtEpochMs <= this.clock.nowEpochMs()) {
      throw new DomainError('UNAUTHENTICATED', 'Inicia sesión para sincronizar.');
    }
    const generation = this.generation;
    return { userId: session.userId, token: session.token, signal: this.controller.signal,
      assertCurrent: () => {
        if (generation !== this.generation || this.session !== session || session.expiresAtEpochMs <= this.clock.nowEpochMs()) {
          throw new DomainError('UNAUTHENTICATED', 'La sesión ha cambiado o ha caducado.');
        }
      } };
  }

  /** Synchronous invalidation; clearing the secret is serialized with any pending login. */
  invalidate(lease?: SessionLease): Promise<void> {
    if (lease) { try { lease.assertCurrent(); } catch { return Promise.resolve(); } }
    this.expiredUser = this.session?.userId ?? this.expiredUser;
    this.session = null; this.rotate(); this.emit();
    return this.writes.run(() => this.storage.deleteItemAsync(KEY));
  }
  async clear(): Promise<void> {
    const clearing = this.invalidate();
    this.expiredUser = null; this.emit();
    await clearing;
  }
}
