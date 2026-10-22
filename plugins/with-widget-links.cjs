/**
 * Android-only bridge for expo-widgets 58.0.22, until upstream supports links.
 * Called during prebuild; npm ci can safely replace node_modules between builds.
 * Deliberately fails on upstream drift instead of silently shipping inert buttons.
 */
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

const VERSION = '58.0.22';
const ANCHOR = 'internal fun WidgetInteraction.toGlanceAction(context: Context): Action {';
const PREVIOUS_MARKER = '// AlarmaT widget links v2';
const PREVIOUS_BRIDGE = `
  ${PREVIOUS_MARKER}
  // Direct activity PendingIntent: Android 12+ forbids notification trampolines.
  // An opening link carries no consent. The app checks session and entity access.
  if (source is InteractionSource.Widget && source.name in setOf("AlarmaTWidget", "AlarmaTAlarmsWidget", "AlarmaTTasksWidget") &&
    (target == "alarmat:///" || target == "alarmat://tasks" || Regex("alarmat://(alarm|task)/[A-Za-z0-9_-]{1,128}").matches(target))) {
    val component = context.packageManager.getLaunchIntentForPackage(context.packageName)?.component
    if (component != null) {
      val openIntent = Intent(Intent.ACTION_VIEW, Uri.parse(target))
        .setComponent(component)
        .setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      return androidx.glance.appwidget.action.actionStartActivity(openIntent)
    }
  }
`;

const MARKER = '// AlarmaT widget links v3';
const TASK_ACTION_PATTERN = 'alarmat-task:([A-Za-z0-9_-]{1,128}):([A-Za-z0-9_-]{1,128}):([A-Za-z0-9_-]{1,128}):([1-9][0-9]{0,15}):(completed|pending)';
const BRIDGE = PREVIOUS_BRIDGE.replace(PREVIOUS_MARKER, MARKER) + `
  // Explicit checklist action: queue intent privately, then authenticate in the full app.
  // IDs are never authorization; the app rechecks account, membership and version.
  if (source is InteractionSource.Widget && source.name in setOf("AlarmaTWidget", "AlarmaTAlarmsWidget", "AlarmaTTasksWidget")) {
    val taskAction = Regex("${TASK_ACTION_PATTERN}").matchEntire(target)
    if (taskAction != null) {
      val version = taskAction.groupValues[4].toLongOrNull()
      if (version != null && version in 1..9007199254740991L) {
        val taskIntent = Intent("expo.modules.alarmruntime.WIDGET_TASK_ACTION")
          .setClassName(context.packageName, "expo.modules.alarmruntime.WidgetTaskActionActivity")
          .setPackage(context.packageName)
          .setData(Uri.parse(target))
          .putExtra("userId", taskAction.groupValues[1])
          .putExtra("groupId", taskAction.groupValues[2])
          .putExtra("taskId", taskAction.groupValues[3])
          .putExtra("expectedVersion", version)
          .putExtra("status", taskAction.groupValues[5])
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return androidx.glance.appwidget.action.actionStartActivity(taskIntent)
      }
    }
  }
`;

// Migrate only the exact reviewed v1 patch in an existing native build cache.
const LEGACY_MARKER = '// AlarmaT widget links v1';
const LEGACY_BRIDGE = PREVIOUS_BRIDGE.replace(PREVIOUS_MARKER, LEGACY_MARKER)
  .replace('source.name in setOf("AlarmaTWidget", "AlarmaTAlarmsWidget", "AlarmaTTasksWidget")', 'source.name == "AlarmaTWidget"')
  .replace(' || target == "alarmat://tasks"', '');

function patchWidgetInteraction(source, version) {
  if (version !== VERSION) throw new Error(`Review AlarmaT widget bridge for expo-widgets ${version}; expected ${VERSION}.`);
  if (source.includes(LEGACY_MARKER)) {
    if (!source.includes(LEGACY_BRIDGE)) throw new Error('AlarmaT legacy widget bridge differs from the reviewed patch.');
    source = source.replace(LEGACY_BRIDGE, BRIDGE);
  }
  if (source.includes(PREVIOUS_MARKER)) {
    if (!source.includes(PREVIOUS_BRIDGE)) throw new Error('AlarmaT previous widget bridge differs from the reviewed patch.');
    source = source.replace(PREVIOUS_BRIDGE, BRIDGE);
  }
  if (source.includes(MARKER)) {
    if (!source.includes(BRIDGE)) throw new Error('AlarmaT widget bridge differs from the reviewed patch.');
    return source;
  }
  if (source.split(ANCHOR).length !== 2) throw new Error('expo-widgets action API changed; refusing an unverified patch.');
  return source.replace(ANCHOR, ANCHOR + BRIDGE);
}

module.exports = function withWidgetLinks(config) {
  return withDangerousMod(config, ['android', async (mod) => {
    const packagePath = require.resolve('expo-widgets/package.json', { paths: [mod.modRequest.projectRoot] });
    const version = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
    const sourcePath = path.join(path.dirname(packagePath), 'android/src/main/java/expo/modules/widgets/WidgetInteractionAction.kt');
    const before = fs.readFileSync(sourcePath, 'utf8');
    const after = patchWidgetInteraction(before, version);
    if (before !== after) fs.writeFileSync(sourcePath, after);
    return mod;
  }]);
};
module.exports.patchWidgetInteraction = patchWidgetInteraction;
