import type { Clock } from '../domain/alarms.ts';
import { DomainError } from '../domain/errors.ts';
import { createIdGenerator, type IdGenerator } from '../domain/ids.ts';
import type { AlarmRuntime } from '../platform/alarms/index.ts';
import { LocalDatabase, type SqlDatabase } from './local/database.ts';
import { LocalStore } from './local/store.ts';
import { SerialQueue } from './model.ts';
import { HttpAlarmGateway, HttpAuthClient, type HttpWireCodec } from './remote/gateway.ts';
import { HttpClient, type FetchPort } from './remote/http.ts';
import { SessionManager, validateSession, type SecureStorage, type SessionView } from './remote/session.ts';
import { PersistentAlarmRepository, type PersistedWidgetSnapshot } from './repositories/alarmRepository.ts';

export type DataClientOptions = {
  allowLocalHttp?: boolean;
  database: SqlDatabase;
  secureStorage: SecureStorage;
  baseUrl: string;
  codec: HttpWireCodec;
  /** Stable installation identity registered with P3, never regenerated on startup. */
  deviceId: string;
  /** Account-scoped installation identity; prevents reusing another account's server device. */
  deviceIdForUser?: (userId: string) => string;
  runtime: AlarmRuntime;
  notificationRuntime?: AlarmRuntime;
  clock?: Clock;
  ids?: IdGenerator;
  fetch?: FetchPort;
  publishWidget?(snapshot: PersistedWidgetSnapshot | null): Promise<void>;
};
export type DataClientView = {
  session: SessionView;
  accountOwner: string | null;
  cleanupPending: boolean;
  repositoryAvailable: boolean;
};
export type LogoutResult = { remoteRevoked: boolean };

/** App composition root. UI receives repositories and session events, never bearer/storage APIs. */
export class DataClient {
  private readonly options: DataClientOptions;
  private readonly database: LocalDatabase;
  private readonly store: LocalStore;
  private readonly sessions: SessionManager;
  private readonly auth: HttpAuthClient;
  private readonly gateway: HttpAlarmGateway;
  private readonly http: HttpClient;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly actions = new SerialQueue();
  private readonly widgetWrites = new SerialQueue();
  private readonly listeners = new Set<(view: DataClientView) => void>();
  private initialization: Promise<void> | undefined;
  private repository: PersistentAlarmRepository | null = null;
  private readonly retired = new Set<PersistentAlarmRepository>();
  private owner: string | null = null;
  private cleanupPending = false;
  private closing = false;
  private busy = false;
  private epoch = 0;

  readonly sessionEvents = {
    view: (): SessionView => this.view().session,
    subscribe: (listener: (session: SessionView) => void): (() => void) => this.subscribe(view => listener(view.session)),
  };
  readonly sync = {
    reconcile: () => {
      const repository = this.getRepository();
      if (!repository) return Promise.reject(new DomainError('UNAUTHENTICATED', 'Inicia sesión para sincronizar.'));
      return repository.reconcile();
    },
  };

  constructor(options: DataClientOptions) {
    if (!/^[A-Za-z0-9_:.-]{1,128}$/.test(options.deviceId)) throw new DomainError('INVALID_ARGUMENT', 'Falta un identificador de instalación registrado.');
    this.options = options;
    this.clock = options.clock ?? { nowEpochMs: () => Date.now() };
    this.ids = options.ids ?? createIdGenerator();
    this.database = new LocalDatabase(options.database);
    this.store = new LocalStore(this.database);
    this.sessions = new SessionManager(options.secureStorage, this.clock);
    const http = new HttpClient({ baseUrl: options.baseUrl, sessions: this.sessions, fetch: options.fetch, nowEpochMs: () => this.clock.nowEpochMs(), allowLocalHttp: options.allowLocalHttp, timeoutMs: 60_000 });
    this.http = http;
    this.gateway = new HttpAlarmGateway(http, this.sessions, options.codec);
    this.auth = new HttpAuthClient(http, this.sessions, options.codec, async candidate => {
      const session = validateSession(candidate, this.clock.nowEpochMs());
      if (this.closing || this.cleanupPending) throw new DomainError('FORBIDDEN', 'Completa la limpieza local antes de iniciar otra sesión.');
      await this.store.bindAccount(session.userId);
      this.owner = session.userId;
    });
    this.sessions.subscribe(() => {
      this.deactivate();
      this.emit();
    });
  }

  view(): DataClientView {
    const raw = this.sessions.view();
    const available = !!this.repository && !this.busy && !this.closing && !this.cleanupPending && !!raw?.authenticated;
    const session = raw ? { ...raw, authenticated: available } : this.owner
      ? { userId: this.owner, authenticated: false, expiresAtEpochMs: 0 } : null;
    return { session, accountOwner: this.owner, cleanupPending: this.cleanupPending, repositoryAvailable: available };
  }
  subscribe(listener: (view: DataClientView) => void): () => void {
    this.listeners.add(listener); listener(this.view());
    return () => { this.listeners.delete(listener); };
  }
  private emit(): void { for (const listener of this.listeners) { try { listener(this.view()); } catch { /* UI observer is not transaction authority. */ } } }
  private deactivate(): void {
    const previous = this.repository;
    this.repository = null;
    if (previous) { previous.deactivate(); this.retired.add(previous); }
    if (previous) void this.publishWidget(null).catch(() => undefined);
  }
  private publishWidget(snapshot: PersistedWidgetSnapshot | null, epoch = this.epoch): Promise<void> {
    return this.widgetWrites.run(async () => {
      if (snapshot && (epoch !== this.epoch || this.closing || !this.sessions.view()?.authenticated)) return;
      await this.options.publishWidget?.(snapshot);
    });
  }

  initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.actions.run(async () => {
        this.busy = true;
        try {
          await this.database.initialize();
          this.owner = await this.store.accountOwner();
          this.cleanupPending = (await this.store.pendingCleanup()).length > 0;
          // Clear any widget left by a previous process before restoring private state.
          await this.publishWidget(null);
          await this.sessions.restore();
          const session = this.sessions.view();
          if (session?.authenticated) {
            try { await this.store.bindAccount(session.userId); }
            catch (error) { await this.sessions.invalidate(); throw error; }
            this.owner = session.userId;
            if (!this.cleanupPending && !this.closing) await this.activate();
          }
        } finally { this.busy = false; this.emit(); }
      });
    }
    return this.initialization;
  }
  /** initialize is idempotent; restoring never resets SENDING while this process is sending. */
  restore(): Promise<void> { return this.initialize(); }

  private buildRepository(userId: string, assertCurrent: () => void): PersistentAlarmRepository {
    const epoch = this.epoch;
    const deviceId = this.options.deviceIdForUser?.(userId) ?? this.options.deviceId;
    if (!/^[A-Za-z0-9_:.-]{1,128}$/.test(deviceId)) throw new DomainError('INVALID_ARGUMENT', 'Identidad de dispositivo inválida.');
    return new PersistentAlarmRepository({ userId, deviceId, store: this.store, gateway: this.gateway,
      runtime: this.options.runtime, notificationRuntime: this.options.notificationRuntime, clock: this.clock, ids: this.ids,
      assertCurrent, publishWidget: snapshot => this.publishWidget(snapshot, epoch) });
  }
  private async activate(): Promise<void> {
    for (const repository of this.retired) await repository.whenIdle();
    this.retired.clear();
    const lease = this.sessions.lease();
    const epoch = ++this.epoch;
    const assertCurrent = () => {
      lease.assertCurrent();
      if (epoch !== this.epoch || this.closing || this.cleanupPending) throw new DomainError('UNAUTHENTICATED', 'La sesión ha cambiado.');
    };
    const repository = this.buildRepository(lease.userId, assertCurrent);
    try { await repository.load(); assertCurrent(); this.repository = repository; }
    catch (error) { repository.deactivate(); throw error; }
  }

  login(payload: unknown): Promise<SessionView> { return this.authenticate('login', payload); }
  register(payload: unknown): Promise<SessionView> { return this.authenticate('register', payload); }
  private async authenticate(action: 'login' | 'register', payload: unknown): Promise<SessionView> {
    if (this.closing || this.cleanupPending) throw new DomainError('FORBIDDEN', 'Completa el cierre de la cuenta anterior.');
    await this.initialize();
    return this.actions.run(async () => {
      if (this.closing || this.cleanupPending) throw new DomainError('FORBIDDEN', 'Completa el cierre de la cuenta anterior.');
      this.busy = true; this.deactivate(); this.emit();
      try {
        await this.publishWidget(null);
        await this.auth[action](payload);
        await this.activate();
        return this.sessions.view();
      } finally { this.busy = false; this.emit(); }
    });
  }
  getRepository(): PersistentAlarmRepository | null {
    if (!this.view().repositoryAvailable) return null;
    return this.repository;
  }

  /** Composition-only resource access using the SAME revocable session/transport. */
  async request(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<unknown> {
    if (!this.view().repositoryAvailable) throw new DomainError('UNAUTHENTICATED', 'Inicia sesión para continuar.');
    return this.http.authenticatedJson(path, method, body);
  }

  logout(): Promise<LogoutResult> {
    this.closing = true; ++this.epoch;
    this.deactivate(); this.sessions.cancelRequests(); this.emit();
    return this.initialize().then(() => this.actions.run(async () => {
      this.busy = true;
      try {
        this.owner = await this.store.accountOwner();
        if (this.owner) {
          this.cleanupPending = true;
          await this.store.beginCleanup(this.owner);
          if (this.retired.size) {
            for (const repository of this.retired) await repository.cleanup(true);
          } else {
            await this.buildRepository(this.owner, () => { throw new DomainError('UNAUTHENTICATED', 'Cierre en curso.'); }).cleanup(true);
          }
          // Native cleanup preserves owner + cleanup marker until SecureStore deletion also commits.
        } else await this.publishWidget(null);
        let remoteRevoked = false;
        if (this.sessions.view()?.authenticated) {
          try { await this.auth.logoutRemote(); remoteRevoked = true; } catch { /* Local logout still proceeds; result reports remote uncertainty. */ }
        }
        await this.sessions.clear();
        if (this.owner) await this.store.clearUser(this.owner);
        this.retired.clear();
        this.owner = null; this.cleanupPending = false;
        return { remoteRevoked };
      } finally { this.busy = false; this.closing = false; this.emit(); }
    }));
  }
}

export function createDataClient(options: DataClientOptions): DataClient { return new DataClient(options); }
