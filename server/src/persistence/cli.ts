import { resolve } from "node:path";
import { openDatabase, backupDatabase } from "./database.ts";
const db = openDatabase(
  process.env.DATABASE_PATH ?? resolve("data/alarmat.db"),
  process.env.MIGRATIONS_DIRECTORY ?? resolve("migrations"),
);
try {
  if (process.argv[2] === "backup") {
    const destination = process.argv[3];
    if (!destination)
      throw new Error("Usage: npm run backup -- /private/path/backup.db");
    await backupDatabase(db, destination);
    process.stdout.write("Backup restored and integrity checked.\n");
  } else if (process.argv[2] === "migrate")
    process.stdout.write("Migrations complete.\n");
  else throw new Error("Expected migrate or backup");
} finally {
  db.close();
}
