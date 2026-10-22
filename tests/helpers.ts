import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DomainError } from '../src/domain/errors.ts';

/** Los tests se ejecutan desde la raíz del repositorio (`npm test`). */
const contractsDir = path.resolve(process.cwd(), 'contracts');

export function readContractsFile<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(contractsDir, relativePath), 'utf8')) as T;
}

export type ManifestEntry = {
  id: string;
  file: string;
  operation?: string;
  payloadSchema?: string;
  schema?: string;
  expect?: string;
  rule?: string;
};

export type Manifest = {
  schemaVersion: number;
  envelopeSchema: string;
  operations: ManifestEntry[];
  documents: ManifestEntry[];
  invalid: ManifestEntry[];
  semantic: ManifestEntry[];
};

export function readManifest(): Manifest {
  return readContractsFile<Manifest>('fixtures/manifest.json');
}

/** Comprueba el código del contrato y devuelve el error para inspeccionar detalles. */
export function expectDomainError(fn: () => unknown, code: string): DomainError {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof DomainError)) {
      assert.fail(`se esperaba DomainError y llegó ${String(error)}`);
    }
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`se esperaba DomainError(${code}) y no se lanzó nada`);
}
