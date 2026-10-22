#!/usr/bin/env node
/**
 * Verificación de los contratos compartidos (P1 + P3).
 *
 * - Los esquemas se validan contra fixtures válidos e inválidos del manifiesto.
 * - Los casos marcados como `semantic` son válidos para JSON Schema y los rechaza
 *   el validador TypeScript de `src/domain` (tests de `tests/contracts.test.ts`).
 * - Ningún fixture puede quedar fuera del manifiesto.
 *
 * Uso: npm run test:contracts
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContractValidator } from './schema-validator.mjs';

const rootDir = fileURLToPath(new URL('../../', import.meta.url));
const contractsDir = path.join(rootDir, 'contracts');
const fixturesDir = path.join(contractsDir, 'fixtures');

const failures = [];
const validator = await createContractValidator(contractsDir);
const manifest = JSON.parse(await readFile(path.join(fixturesDir, 'manifest.json'), 'utf8'));

async function readFixture(relativePath) {
  const raw = await readFile(path.join(contractsDir, relativePath), 'utf8');
  return JSON.parse(raw);
}

function fail(message) {
  failures.push(message);
}

// 0. Los schemas solo usan palabras clave soportadas por el validador local.
const schemaFiles = (await readdir(path.join(contractsDir, 'schemas'))).filter((name) => name.endsWith('.json'));
for (const file of schemaFiles) {
  const keywordErrors = [];
  await validator.auditSchemaKeywords(path.posix.join('schemas', file), keywordErrors);
  for (const error of keywordErrors) fail(`esquema ${file}: ${error}`);
}

async function expectValid(value, schemaPath, label) {
  const errors = await validator.validate(value, schemaPath);
  if (errors.length > 0) {
    fail(`${label}: debería ser válido y no lo es\n    ${errors.join('\n    ')}`);
  }
}

async function expectInvalid(value, schemaPath, label) {
  const errors = await validator.validate(value, schemaPath);
  if (errors.length === 0) fail(`${label}: debería rechazarse y el esquema lo acepta`);
  return errors.length;
}

// 1. Operaciones: sobre + payload.
for (const entry of manifest.operations) {
  const operation = await readFixture(entry.file);
  await expectValid(operation, manifest.envelopeSchema, `${entry.id} (sobre)`);
  await expectValid(operation.payload, entry.payloadSchema, `${entry.id} (payload)`);
  if (operation.payload === undefined) fail(`${entry.id}: falta payload`);
}

// 2. Documentos compartidos.
for (const entry of manifest.documents) {
  await expectValid(await readFixture(entry.file), entry.schema, entry.id);
}

// 3. Casos inválidos por forma.
for (const entry of manifest.invalid) {
  const operation = await readFixture(entry.file);
  if (entry.payloadSchema) {
    await expectInvalid(operation.payload, entry.payloadSchema, `${entry.id} (payload)`);
  } else {
    await expectInvalid(operation, manifest.envelopeSchema, `${entry.id} (sobre)`);
  }
}

// 4. Casos semánticos: la forma es válida; el rechazo lo prueba src/domain.
for (const entry of manifest.semantic) {
  const operation = await readFixture(entry.file);
  await expectValid(operation, manifest.envelopeSchema, `${entry.id} (sobre)`);
  const payloadSchema = manifest.operations.find((item) => item.operation === entry.operation)?.payloadSchema;
  if (!payloadSchema) {
    fail(`${entry.id}: no hay esquema de payload registrado para ${entry.operation}`);
    continue;
  }
  await expectValid(operation.payload, payloadSchema, `${entry.id} (payload)`);
  if (!operation.payload) fail(`${entry.id}: falta payload`);
  if (!entry.expect || !entry.rule) fail(`${entry.id}: el manifiesto debe documentar expect y rule`);
}

// 5. Cobertura: todo fixture está en el manifiesto y viceversa.
const listed = new Set(
  [...manifest.operations, ...manifest.documents, ...manifest.invalid, ...manifest.semantic].map((entry) => entry.file),
);
const found = [];
for (const folder of ['operations', 'documents', 'invalid', 'semantic']) {
  for (const name of await readdir(path.join(fixturesDir, folder))) {
    if (name.endsWith('.json')) found.push(`fixtures/${folder}/${name}`);
  }
}
for (const file of found) {
  if (!listed.has(file)) fail(`${file}: fixture sin entrada en manifest.json`);
}
for (const file of listed) {
  if (!found.includes(file)) fail(`${file}: el manifiesto apunta a un fixture inexistente`);
}

const total = manifest.operations.length + manifest.documents.length + manifest.invalid.length + manifest.semantic.length;
if (failures.length > 0) {
  console.error(`Contratos v${manifest.schemaVersion}: ${failures.length} problema(s)\n`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Contratos v${manifest.schemaVersion} verificados: ${total} fixtures, ${schemaFiles.length} esquemas.`);
