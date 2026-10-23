#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
source_root=${1:-backend}
target_root=${CARGO_TARGET_DIR:-"$source_root/target"}
if [ -n "${CARGO_TARGET_DIR:-}" ]; then
  case "$target_root" in /*) ;; *) target_root="$source_root/$target_root" ;; esac
fi
lipo "$target_root/release/xodus-cli" -verify_arch arm64
lipo "$target_root/release/xodus-service" -verify_arch arm64
mkdir -p native-backend/target/release
cp "$target_root/release/xodus-cli" "$target_root/release/xodus-service" native-backend/target/release/
cp "$source_root/LICENSE" native-backend/LICENSE
cp assets/backend-source.lock.json native-backend/source-recipe.json
# Sign locally so the executables keep a stable code identity for Keychain access.
codesign --force --sign - --identifier org.xodusgaming.nexus.cli native-backend/target/release/xodus-cli
codesign --force --sign - --identifier org.xodusgaming.nexus.service native-backend/target/release/xodus-service
