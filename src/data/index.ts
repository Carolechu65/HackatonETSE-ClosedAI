/** Non-native entrypoint for P2/P6 and tests. Native storage is in ./mobile.ts. */
export { createDataClient, DataClient } from './client.ts';
export type { DataClientOptions, DataClientView, LogoutResult } from './client.ts';
export { PersistentAlarmRepository, PendingOperationError } from './repositories/alarmRepository.ts';
export type { AlarmView, DataSnapshot, PersistedWidgetSnapshot } from './repositories/alarmRepository.ts';
export type { HttpWireCodec } from './remote/gateway.ts';
export type { AlarmRecord, SyncPage, SyncEvent, PendingOperation } from './model.ts';
