import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseWidgetLink, tasksLink, widgetLinkToRoute } from '../src/widgets/links.ts';

test('task list links open the task screen without accepting mutations or foreign hosts', () => {
  assert.equal(widgetLinkToRoute(tasksLink()), '/tasks');
  assert.deepEqual(parseWidgetLink('alarmat:///tasks'), { kind: 'tasks' });
  for (const url of ['alarmat://tasks?complete=1', 'alarmat://tasks#complete', 'alarmat://evil.com/tasks', 'alarmat://tasks/extra']) {
    assert.equal(widgetLinkToRoute(url), null, url);
  }
});

test('native bridge upgrades the reviewed installed v1 patch and rejects altered legacy code', () => {
  const require = createRequire(resolve('package.json'));
  const { patchWidgetInteraction } = require('./plugins/with-widget-links.cjs');
  const legacy = `internal fun WidgetInteraction.toGlanceAction(context: Context): Action {
  // AlarmaT widget links v1
  // Direct activity PendingIntent: Android 12+ forbids notification trampolines.
  // An opening link carries no consent. The app checks session and entity access.
  if (source is InteractionSource.Widget && source.name == "AlarmaTWidget" &&
    (target == "alarmat:///" || Regex("alarmat://(alarm|task)/[A-Za-z0-9_-]{1,128}").matches(target))) {
    val component = context.packageManager.getLaunchIntentForPackage(context.packageName)?.component
    if (component != null) {
      val openIntent = Intent(Intent.ACTION_VIEW, Uri.parse(target))
        .setComponent(component)
        .setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      return androidx.glance.appwidget.action.actionStartActivity(openIntent)
    }
  }
}`;
  const upgraded = patchWidgetInteraction(legacy, '58.0.22');
  assert.match(upgraded, /AlarmaT widget links v3/);
  assert.doesNotMatch(upgraded, /AlarmaT widget links v1/);
  assert.equal(patchWidgetInteraction(upgraded, '58.0.22'), upgraded);
  assert.throws(() => patchWidgetInteraction(legacy.replace('setPackage(context.packageName)', 'setPackage("elsewhere")'), '58.0.22'), /legacy widget bridge differs/);
});
