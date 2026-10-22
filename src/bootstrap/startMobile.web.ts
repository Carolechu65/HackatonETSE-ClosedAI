import type { DataClient } from '../data/client.ts';
import type { MobileDataClientOptions } from '../data/mobile.ts';

/** The browser composition uses its online HTTP adapter, never native SQLite. */
export async function startMobileServices(_options: MobileDataClientOptions & { enablePush?: boolean }): Promise<DataClient> {
  throw new Error('Los servicios locales de Android requieren la app instalada.');
}
