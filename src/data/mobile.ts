import { openDatabaseAsync } from 'expo-sqlite';
import { createDataClient, type DataClient, type DataClientOptions } from './client.ts';
import { expoSecureStorage } from './remote/expoSecureStorage.ts';

export type MobileDataClientOptions = Omit<DataClientOptions, 'database' | 'secureStorage'> & { databaseName?: string };

/** Explicit opt-in integration for P1; it does not replace or auto-connect the demo entrypoint. */
export async function openMobileDataClient(options: MobileDataClientOptions): Promise<DataClient> {
  const database = await openDatabaseAsync(options.databaseName ?? 'alarmat-data.db', { useNewConnection: true });
  try {
    const client = createDataClient({ ...options, database, secureStorage: expoSecureStorage });
    await client.initialize();
    return client;
  } catch (error) { await database.closeAsync(); throw error; }
}
