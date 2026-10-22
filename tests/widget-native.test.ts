import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(resolve('package.json'));
const { patchWidgetInteraction } = require('./plugins/with-widget-links.cjs') as {
  patchWidgetInteraction: (source: string, version: string) => string;
};
const packagePath = require.resolve('expo-widgets/package.json');
const installed = JSON.parse(readFileSync(packagePath, 'utf8')) as { version: string };
const source = readFileSync(join(dirname(packagePath), 'android/src/main/java/expo/modules/widgets/WidgetInteractionAction.kt'), 'utf8');

test('native widget bridge applies once and fails closed on dependency drift', () => {
  const patched = patchWidgetInteraction(source, installed.version);
  assert.equal(patchWidgetInteraction(patched, installed.version), patched);
  assert.throws(() => patchWidgetInteraction(source, '59.0.0'), /Review/);
  assert.throws(() => patchWidgetInteraction('upstream API changed', installed.version), /API changed/);
  assert.match(patched, /actionStartActivity\(openIntent\)/);
  assert.match(patched, /setComponent\(component\)/);
  assert.match(patched, /source.name == "AlarmaTWidget"/);
  assert.match(patched, /return actionSendBroadcast\(intent\)/, 'other upstream actions remain available');
});

test('native opening policy refuses consent parameters, external destinations and traversal', () => {
  const patched = patchWidgetInteraction(source, installed.version);
  const nativePattern = /Regex\("([^"]+)"\)\.matches\(target\)/.exec(patched)?.[1];
  assert.ok(nativePattern);
  const allowed = new RegExp(`^(?:${nativePattern})$`);
  assert.equal(allowed.test('alarmat://alarm/req-1'), true);
  assert.equal(allowed.test('alarmat://task/task_1'), true);
  for (const destination of [
    'https://example.org', 'alarmat://alarm/x?decision=ACCEPTED', 'alarmat://alarm/x#accept',
    'alarmat://alarm/..', 'alarmat://alarm/%2e%2e', 'alarmat://alarm/x/extra', 'alarmat://alarm/',
  ]) assert.equal(allowed.test(destination), false, destination);
});
