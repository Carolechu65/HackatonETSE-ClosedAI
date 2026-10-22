import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Node 22 does not accept a directory as a --test entrypoint. Enumerate nested TS suites,
// fail on zero tests, and use the same executable so CI/local do not silently switch Node.
const files = readdirSync('tests', { recursive: true })
  .filter(file => file.endsWith('.test.ts')).sort().map(file => join('tests', file));
if (files.length === 0) throw new Error('No test suites found.');
const result = spawnSync(process.execPath, [
  '--experimental-strip-types', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--test', ...files,
], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
