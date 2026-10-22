import { openMobileDataClient, type MobileDataClientOptions } from '../data/mobile.ts';
import { initializeBootstrap } from './index.ts';
import { createExpoBootstrapSources } from './expoSources.ts';

let startup: ReturnType<typeof openMobileDataClient> | undefined;

/** Called once by P1's composition after P3 supplies URL, wire codecs and device registration.
 * Importing this module does not initialize a session, ask permissions, or replace the demo.
 */
export function startMobileServices(options: MobileDataClientOptions & { enablePush?: boolean }) {
  if (!startup) {
    startup = openMobileDataClient(options).then(client => {
      initializeBootstrap({ session: client.sessionEvents, sync: client.sync,
        sources: createExpoBootstrapSources({ enablePush: options.enablePush ?? false }) });
      return client;
    }).catch(error => { startup = undefined; throw error; });
  }
  return startup;
}
