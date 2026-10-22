import type { SessionView } from '../data/remote/session.ts';
import { parseRemoteChangeHint, RemoteHintDeduplicator } from '../platform/sync/remoteEvents.ts';

export interface ValueSource<T> { getSnapshot(): T; subscribe(listener: (value: T) => void): () => void }
export interface BootstrapSources {
  appState: ValueSource<string>;
  network: ValueSource<boolean>;
  push?: { subscribe(listener: (data: unknown) => void): () => void };
}
export interface BootstrapScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}
export interface BootstrapOptions {
  session: { view(): SessionView; subscribe(listener: (view: SessionView) => void): () => void };
  /** Reconciler must independently lease/check the current session at every asynchronous boundary. */
  sync: { reconcile(): Promise<unknown> };
  sources: BootstrapSources;
  scheduler?: BootstrapScheduler;
  pollIntervalMs?: number;
  maxForegroundPolls?: number;
  onError?: (error: unknown) => void;
}

/** No background timers, no implicit permission requests, and no presentation of push content. */
export function createBootstrapController(options: BootstrapOptions) {
  const scheduler = options.scheduler ?? {
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const interval = options.pollIntervalMs ?? 30_000;
  const maxPolls = options.maxForegroundPolls ?? 10;
  if (!Number.isFinite(interval) || interval < 1 || !Number.isSafeInteger(maxPolls) || maxPolls < 0) {
    throw new Error('Invalid foreground polling configuration');
  }
  const hints = new RemoteHintDeduplicator();
  let started = false;
  let generation = 0;
  let active = false;
  let online = false;
  let authenticated = false;
  let busy = false;
  let queued = false;
  let remainingPolls = maxPolls;
  let timer: unknown;
  let hasTimer = false;
  let timerVersion = 0;
  let unsubscribeSession: (() => void) | undefined;
  let subscriptions: (() => void)[] = [];

  const report = (error: unknown) => { try { options.onError?.(error); } catch { /* observers cannot break lifecycle */ } };
  const eligible = () => started && authenticated && active && online && !!options.session.view()?.authenticated;
  function clearTimer() {
    timerVersion++;
    if (hasTimer) scheduler.clearTimeout(timer);
    hasTimer = false;
  }
  function schedulePoll() {
    if (!eligible() || busy || hasTimer || remainingPolls === 0) return;
    const owner = generation;
    const version = ++timerVersion;
    hasTimer = true;
    timer = scheduler.setTimeout(() => {
      if (version !== timerVersion || owner !== generation) return;
      hasTimer = false;
      if (!eligible()) return;
      remainingPolls--;
      requestSync();
    }, interval);
  }
  function requestSync(): void {
    if (!eligible()) return;
    clearTimer();
    if (busy) { queued = true; return; }
    busy = true;
    const owner = generation;
    // Catch synchronous throws as well as promise rejection. Never retry in an immediate error loop.
    void Promise.resolve().then(() => {
      if (owner !== generation || !eligible()) return;
      return options.sync.reconcile();
    }).catch(error => { if (owner === generation && started) report(error); }).finally(() => {
      busy = false;
      if (queued && eligible()) { queued = false; requestSync(); }
      else { queued = false; schedulePoll(); }
    });
  }
  function unbind() {
    generation++;
    clearTimer();
    queued = false;
    hints.clear();
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  }
  function bind(view: SessionView) {
    unbind();
    authenticated = !!view?.authenticated;
    if (!started || !authenticated) return;
    const owner = generation;
    const current = () => started && owner === generation;
    let binding = true;
    active = options.sources.appState.getSnapshot() === 'active';
    online = options.sources.network.getSnapshot();
    remainingPolls = maxPolls;
    subscriptions.push(options.sources.appState.subscribe(value => {
      if (!current()) return;
      const wasActive = active;
      active = value === 'active';
      if (!active) { clearTimer(); queued = false; }
      else if (!wasActive) { remainingPolls = maxPolls; if (!binding) requestSync(); }
    }));
    subscriptions.push(options.sources.network.subscribe(value => {
      if (!current()) return;
      const wasOnline = online;
      online = value;
      if (!online) { clearTimer(); queued = false; }
      else if (!wasOnline) { remainingPolls = maxPolls; if (!binding) requestSync(); }
    }));
    if (options.sources.push) subscriptions.push(options.sources.push.subscribe(data => {
      if (!current() || !eligible()) return;
      const hint = parseRemoteChangeHint(data);
      if (hint && hints.accept(hint) && !binding) requestSync();
    }));
    binding = false;
    requestSync();
  }
  return {
    start(): void {
      if (started) return;
      started = true;
      let emitted = false;
      unsubscribeSession = options.session.subscribe(view => { emitted = true; bind(view); });
      if (!emitted) bind(options.session.view());
    },
    stop(): void {
      if (!started) return;
      started = false;
      unsubscribeSession?.();
      unsubscribeSession = undefined;
      unbind();
    },
    requestSync,
  };
}
export type BootstrapController = ReturnType<typeof createBootstrapController>;
