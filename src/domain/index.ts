/**
 * Punto de entrada del dominio. Consumidores (P2, P4, P5, P6) importan desde aquí
 * y no desde adaptadores concretos: Firebase y Android quedan detrás de puertos.
 */
export * from './alarms.ts';
export * from './states.ts';
export * from './errors.ts';
export * from './time.ts';
export * from './ids.ts';
export * from './http.ts';
export * from './consent.ts';
export * from './ports.ts';
export * from './fakes.ts';
export * from './contracts/types.ts';
export * from './contracts/validate.ts';
export * from './contracts/operations.ts';
