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
  assert.match(patched, /source.name in setOf\("AlarmaTWidget", "AlarmaTAlarmsWidget", "AlarmaTTasksWidget"\)/);
  assert.match(patched, /target == "alarmat:\/\/tasks"/);
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

test('checklist actions are strict explicit activity commands with distinct PendingIntent identities', () => {
  const patched = patchWidgetInteraction(source, installed.version);
  const pattern = /val taskAction = Regex\("([^"]+)"\)\.matchEntire\(target\)/.exec(patched)?.[1];
  assert.ok(pattern);
  const allowed = new RegExp(`^(?:${pattern})$`);
  for (const status of ['completed', 'pending']) {
    assert.equal(allowed.test(`alarmat-task:user_1:group-1:task_2:12:${status}`), true);
  }
  for (const target of ['alarmat-task:u:g:t:0:completed', 'alarmat-task:u:g:t:-1:pending',
    'alarmat-task:u:g:t:1:accepted', 'alarmat-task:u:g:t:1:completed?admin=1',
    'alarmat-task:u:g:../t:1:completed', 'alarmat-task:u:g:t:1:completed:extra',
    'alarmat-task:u:g:t:10000000000000000:completed']) assert.equal(allowed.test(target), false, target);
  assert.match(patched, /version in 1\.\.9007199254740991L/);
  assert.match(patched, /setClassName\(context.packageName, "expo.modules.alarmruntime.WidgetTaskActionActivity"\)/);
  assert.match(patched, /setData\(Uri.parse\(target\)\)/);
  assert.match(patched, /actionStartActivity\(taskIntent\)/);
  const manifest = readFileSync('modules/alarm-runtime/android/src/main/AndroidManifest.xml', 'utf8');
  assert.match(manifest, /WidgetTaskActionActivity"\s+android:exported="false"/);
});

test('bridge migrates the exact previous patch and refuses tampered cached native code', () => {
  const clean = 'internal fun WidgetInteraction.toGlanceAction(context: Context): Action {\n}';
  const patched = patchWidgetInteraction(clean, installed.version);
  const previous = patched.slice(0, patched.indexOf('  // Explicit checklist action:'))
    .replace('// AlarmaT widget links v3', '// AlarmaT widget links v2') + '}';
  assert.equal(patchWidgetInteraction(previous, installed.version), patched);
  assert.throws(() => patchWidgetInteraction(previous.replace('alarmat://tasks', 'alarmat://bad'), installed.version), /previous widget bridge differs/);
});
