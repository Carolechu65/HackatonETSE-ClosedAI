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
const MARKER = '// AlarmaT widget links v1';
const BRIDGE = `
  ${MARKER}
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
`;

function patchWidgetInteraction(source, version) {
  if (version !== VERSION) throw new Error(`Review AlarmaT widget bridge for expo-widgets ${version}; expected ${VERSION}.`);
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
