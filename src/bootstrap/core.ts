import { createBootstrapController, type BootstrapController, type BootstrapOptions } from './controller.ts';
export { createBootstrapController } from './controller.ts';
export type { BootstrapOptions, BootstrapSources, BootstrapController, BootstrapScheduler, ValueSource } from './controller.ts';

export type BootstrapStatus = {
  mode: 'demo' | 'configured';
  backgroundHandlersRegistered: false;
  reason?: string;
};
let controller: BootstrapController | undefined;
let status: BootstrapStatus = {
  mode: 'demo', backgroundHandlersRegistered: false,
  reason: 'API, sesión y repositorio no configurados. Los datos de ejemplo no se sincronizan.',
};

/** Safe before Router. An integrator supplies configured services; no guessed API protocol/URL. */
export function initializeBootstrap(options?: BootstrapOptions): BootstrapStatus {
  if (controller || !options) return status;
  controller = createBootstrapController(options);
  controller.start();
  status = { mode: 'configured', backgroundHandlersRegistered: false };
  return status;
}
export function stopBootstrap(): void {
  controller?.stop();
  controller = undefined;
  status = { mode: 'demo', backgroundHandlersRegistered: false, reason: 'Sincronización detenida.' };
}

