#!/usr/bin/env bash
# Re-sign a verified CI candidate locally; production identity never leaves VPS.
set -euo pipefail
: "${ANDROID_HOME:?Set ANDROID_HOME}"
: "${ALARMAT_ANDROID_KEYSTORE:?Load external production signing environment}"
: "${ALARMAT_ANDROID_STORE_PASSWORD:?Missing keystore password}"
: "${ALARMAT_ANDROID_KEY_ALIAS:?Missing production alias}"
: "${ALARMAT_ANDROID_KEY_PASSWORD:?Missing key password}"
if [ "$#" -ne 2 ]; then
  printf 'Usage: %s candidate.apk production.apk\n' "$0" >&2
  exit 2
fi
candidate=$1
output=$2
if [ "$candidate" = "$output" ]; then
  printf 'Use separate candidate and production paths.\n' >&2
  exit 2
fi
signer="$ANDROID_HOME/build-tools/37.0.0/apksigner"
badging=$("$ANDROID_HOME/build-tools/37.0.0/aapt2" dump badging "$candidate")
if [[ "$badging" != *"package: name='com.closedai.alarmat'"* ]]; then
  printf 'Unexpected APK package; refusing production signing.\n' >&2
  exit 2
fi
"$ANDROID_HOME/build-tools/37.0.0/zipalign" -c -P 16 4 "$candidate"
"$signer" verify "$candidate"
"$signer" sign --ks "$ALARMAT_ANDROID_KEYSTORE" \
  --debuggable-apk-permitted false \
  --ks-key-alias "$ALARMAT_ANDROID_KEY_ALIAS" \
  --ks-pass env:ALARMAT_ANDROID_STORE_PASSWORD \
  --key-pass env:ALARMAT_ANDROID_KEY_PASSWORD \
  --out "$output" "$candidate"
"$signer" verify --verbose --print-certs "$output"
sha256sum "$output" > "$output.sha256"
printf 'Signed production APK: %s\n' "$output"
