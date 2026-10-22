import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBootstrapController, type BootstrapScheduler } from '../../src/bootstrap/controller.ts';
import { initializeBootstrap, stopBootstrap } from '../../src/bootstrap/index.ts';
import { parseRemoteChangeHint, RemoteHintDeduplicator } from '../../src/platform/sync/remoteEvents.ts';
import type { SessionView } from '../../src/data/remote/session.ts';

class Source<T> {
  value: T;
  listeners = new Set<(value: T) => void>();
  history: ((value: T) => void)[] = [];
  constructor(value: T) { this.value = value; }
  getSnapshot = () => this.value;
  view = () => this.value;
  subscribe = (listener: (value: T) => void) => {
    this.listeners.add(listener); this.history.push(listener);
    return () => { this.listeners.delete(listener); };
  };
  emit(value: T) { this.value = value; for (const listener of this.listeners) listener(value); }
}
class FakeTimers implements BootstrapScheduler {
  jobs = new Map<number, () => void>();
  next = 0;
  setTimeout(callback: () => void) { const id = ++this.next; this.jobs.set(id, callback); return id; }
  clearTimeout(handle: unknown) { this.jobs.delete(handle as number); }
  tick() { const callbacks = [...this.jobs.values()]; this.jobs.clear(); for (const callback of callbacks) callback(); }
}
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function setup(reconcile: () => Promise<unknown> = async () => {}) {
  const session = new Source<SessionView>({ userId: 'a', authenticated: true, expiresAtEpochMs: 9999999999999 });
  const appState = new Source('active');
  const network = new Source(true);
  const push = new Source<unknown>(null);
  const scheduler = new FakeTimers();
  let calls = 0;
  const errors: unknown[] = [];
  const options = { session, sources: { appState, network, push }, scheduler, maxForegroundPolls: 2,
    sync: { reconcile: async () => { calls++; return reconcile(); } }, onError: (error: unknown) => { errors.push(error); } };
  const controller = createBootstrapController(options);
  return { controller, options, session, appState, network, push, scheduler, errors, calls: () => calls };
}

test('register repeated starts once; bounded polls stop and resume restarts foreground window', async () => {
  const t = setup(); t.controller.start(); t.controller.start(); await settle();
  assert.equal(t.calls(), 1); assert.equal(t.appState.listeners.size, 1);
  t.scheduler.tick(); await settle(); t.scheduler.tick(); await settle();
  assert.equal(t.calls(), 3); assert.equal(t.scheduler.jobs.size, 0);
  t.appState.emit('background'); t.push.emit({ eventId: 'ignored' }); t.scheduler.tick(); await settle();
  assert.equal(t.calls(), 3);
  t.appState.emit('active'); await settle(); assert.equal(t.calls(), 4);
  t.controller.stop(); assert.equal(t.scheduler.jobs.size, 0);
  assert.equal(t.appState.listeners.size + t.network.listeners.size + t.push.listeners.size + t.session.listeners.size, 0);
});

test('offline never fetches and reconnection fetches once', async () => {
  const t = setup(); t.network.emit(false); t.controller.start(); await settle();
  assert.equal(t.calls(), 0); assert.equal(t.scheduler.jobs.size, 0);
  t.network.emit(true); t.network.emit(true); await settle(); assert.equal(t.calls(), 1);
  t.network.emit(false); assert.equal(t.scheduler.jobs.size, 0); t.controller.stop();
});

test('push deduplicates hints, ignores content without ID, and never overlaps reconciliation', async () => {
  let release: (() => void) | undefined;
  const t = setup(() => new Promise<void>(resolve => { release = resolve; }));
  t.controller.start(); await settle();
  t.push.emit({ eventId: 'e1', version: 1, body: 'program me' });
  t.push.emit({ eventId: 'e1', version: 1 }); t.push.emit({ body: 'alarm' });
  assert.equal(t.calls(), 1); assert.equal(t.scheduler.jobs.size, 0);
  release!(); await settle(); assert.equal(t.calls(), 2);
  release!(); await settle();
  t.push.emit({ eventId: 'e1', version: 1 }); await settle(); assert.equal(t.calls(), 2);
  t.controller.stop();
});

test('session change rejects old push/network callbacks and old errors; waits for old request', async () => {
  let reject: ((error: Error) => void) | undefined;
  const t = setup(() => new Promise<void>((_, fail) => { reject = fail; }));
  t.controller.start(); await settle();
  const oldPush = t.push.history[0]!; const oldNetwork = t.network.history[0]!;
  t.session.emit({ userId: 'b', authenticated: true, expiresAtEpochMs: 9999999999999 });
  oldPush({ eventId: 'old' }); oldNetwork(false); await settle();
  assert.equal(t.calls(), 1);
  reject!(new Error('old account failure')); await settle();
  assert.equal(t.calls(), 2); assert.deepEqual(t.errors, []);
  t.controller.stop(); reject!(new Error('after teardown')); await settle(); assert.deepEqual(t.errors, []);
});

test('logout detaches all sources and completion cannot recreate a timer', async () => {
  let release: (() => void) | undefined;
  const t = setup(() => new Promise<void>(resolve => { release = resolve; }));
  t.controller.start(); await settle(); t.session.emit(null);
  release!(); await settle();
  assert.equal(t.scheduler.jobs.size, 0); assert.equal(t.push.listeners.size, 0); t.controller.stop();
});

test('rejected sync retries only at bounded polling intervals, without unhandled rejection', async () => {
  const t = setup(async () => { throw new Error('offline'); });
  t.controller.start(); await settle(); assert.equal(t.calls(), 1);
  await settle(); assert.equal(t.calls(), 1);
  for (let i = 0; i < 5; i++) { t.scheduler.tick(); await settle(); }
  assert.equal(t.calls(), 3); assert.equal(t.errors.length, 3); assert.equal(t.scheduler.jobs.size, 0);
  t.controller.stop();
});

test('bootstrap defaults to explicit demo and permits subsequent idempotent configuration', async () => {
  stopBootstrap(); const t = setup(); assert.equal(initializeBootstrap().mode, 'demo');
  assert.equal(initializeBootstrap(t.options).mode, 'configured'); initializeBootstrap(t.options);
  await settle(); assert.equal(t.calls(), 1); stopBootstrap(); assert.equal(t.scheduler.jobs.size, 0);
});

test('dedup memory bounded; version distinctions and malformed hints', () => {
  const dedup = new RemoteHintDeduplicator(2);
  assert.equal(dedup.accept({ eventId: 'a', version: 1 }), true);
  assert.equal(dedup.accept({ eventId: 'a', version: 1 }), false);
  assert.equal(dedup.accept({ eventId: 'a', version: 2 }), true);
  dedup.accept({ eventId: 'b' }); assert.equal(dedup.accept({ eventId: 'a', version: 1 }), true);
  assert.equal(parseRemoteChangeHint({ eventId: '' }), null);
  assert.equal(parseRemoteChangeHint({ eventId: 'a', version: -1 }), null);
  assert.equal(parseRemoteChangeHint({ eventId: 'x'.repeat(257) }), null);
});

test('sources that emit their initial value synchronously still initialize only once', async () => {
  const t = setup(); t.network.value = false;
  const subscribe = t.network.subscribe;
  t.network.subscribe = listener => { const unsubscribe = subscribe(listener); listener(true); return unsubscribe; };
  t.controller.start(); await settle(); assert.equal(t.calls(), 1); t.controller.stop();
});

test('a cancelled timer callback cannot perturb a new foreground timer', async () => {
  const t = setup(); t.controller.start(); await settle();
  const oldTimer = [...t.scheduler.jobs.values()][0]!;
  t.appState.emit('background'); t.appState.emit('active'); await settle();
  assert.equal(t.calls(), 2); oldTimer(); await settle();
  assert.equal(t.calls(), 2); assert.equal(t.scheduler.jobs.size, 1); t.controller.stop();
});
