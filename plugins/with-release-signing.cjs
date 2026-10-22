/** Keep the release identity outside git, and refuse debug-signed release APKs. */
const { withAppBuildGradle } = require('expo/config-plugins');
const MARKER = '// AlarmaT production signing';
module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    let source = mod.modResults.contents;
    if (source.includes(MARKER)) return mod;
    const anchor = '    buildTypes {';
    if (!source.includes(anchor)) throw new Error('Android buildTypes layout changed; review production signing.');
    source = source.replace(anchor, `    ${MARKER}
    def alarmatKeystore = System.getenv('ALARMAT_ANDROID_KEYSTORE')
    if (alarmatKeystore) {
        signingConfigs.create('production') {
            storeFile file(alarmatKeystore)
            storePassword System.getenv('ALARMAT_ANDROID_STORE_PASSWORD')
            keyAlias System.getenv('ALARMAT_ANDROID_KEY_ALIAS')
            keyPassword System.getenv('ALARMAT_ANDROID_KEY_PASSWORD')
        }
    } else if (gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }) {
        throw new GradleException('Release requires the external ALARMAT_ANDROID_* signing environment.')
    }
${anchor}`);
    const releaseAnchor = /release \{([\s\S]*?)signingConfig signingConfigs.debug/;
    if (!releaseAnchor.test(source)) throw new Error('Android release signing layout changed.');
    source = source.replace(releaseAnchor, "release {$1signingConfig alarmatKeystore ? signingConfigs.production : signingConfigs.debug");
    mod.modResults.contents = source;
    return mod;
  });
};
