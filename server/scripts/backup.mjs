import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const source = process.argv[2] ?? process.env.DATABASE_PATH;
const destination = process.argv[3];

if (!source || !destination) {
  console.error('Uso: node scripts/backup.mjs <origen.db> <destino.db>');
  console.error('Copia consistente con Online Backup API; no copies el .db abierto en WAL.');
  process.exit(1);
}
if (!existsSync(source)) {
  console.error(`No existe la base de origen: ${source}`);
  process.exit(1);
}

const sourcePath = resolve(source);
const destinationPath = resolve(destination);
mkdirSync(dirname(destinationPath), { recursive: true });

const db = new Database(sourcePath, { readonly: true });
try {
  await db.backup(destinationPath);
} finally {
  db.close();
}

const copy = new Database(destinationPath, { readonly: true });
try {
  const integrity = String(copy.pragma('integrity_check', { simple: true }));
  if (integrity !== 'ok') {
    console.error(`La copia no pasa integrity_check: ${integrity}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ source: sourcePath, destination: destinationPath, integrity }));
} finally {
  copy.close();
}
