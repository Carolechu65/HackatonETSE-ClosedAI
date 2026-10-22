import { loadConfig } from './config.ts';
import { openDatabase, migrate } from './persistence/db.ts';

const config = loadConfig();
const db = openDatabase(config.databasePath);
try {
  const result = migrate(db);
  console.log(JSON.stringify({
    databasePath: config.databasePath,
    schemaVersion: result.schemaVersion,
    applied: result.applied,
  }));
} finally {
  db.close();
}
