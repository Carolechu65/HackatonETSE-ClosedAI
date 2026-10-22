export * from './core.ts';

/** Opt-in native composition. Dynamic import keeps tests/demo free of eager native side effects. */
export async function startConfiguredMobileServices(
  options: import('../data/mobile.ts').MobileDataClientOptions & { enablePush?: boolean },
) {
  const { startMobileServices } = await import('./startMobile.ts');
  return startMobileServices(options);
}
