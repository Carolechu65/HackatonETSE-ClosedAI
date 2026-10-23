#!/usr/bin/env bash
# Prerequisites: Node 22, JDK compatible with Gradle 9.4, Android SDK 37/NDK27.1.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ANDROID_HOME:?Set ANDROID_HOME to the installed Android SDK}"
: "${ALARMAT_ANDROID_KEYSTORE:?Load the external Android signing environment}"
: "${ALARMAT_ANDROID_STORE_PASSWORD:?Missing keystore password}"
: "${ALARMAT_ANDROID_KEY_ALIAS:?Missing signing alias}"
: "${ALARMAT_ANDROID_KEY_PASSWORD:?Missing signing key password}"
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://gex-dashboard.hopto.org/alarmat/api}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}"
unset ALARMAT_WEB_BASE_PATH
node node_modules/expo/bin/cli prebuild --platform android --no-install
cd android
./gradlew :app:assembleRelease --no-daemon --max-workers=1 \
  -Dorg.gradle.parallel=false \
  "-Dorg.gradle.jvmargs=${ALARMAT_ANDROID_JVMARGS:--Xmx1536m -XX:MaxMetaspaceSize=384m -XX:ActiveProcessorCount=2}" \
  -Pkotlin.compiler.execution.strategy=in-process \
  -PreactNativeArchitectures=arm64-v8a \
  -Pandroid.enableMinifyInReleaseBuilds=true \
  -Pandroid.enableShrinkResourcesInReleaseBuilds=true
printf '\nSigned standalone APK: android/app/build/outputs/apk/release/app-release.apk\n'
