#!/bin/bash
# ConfluenceX Build Script
# Usage:
#   ./build.sh chrome    -> builds confluencex-chrome.zip
#   ./build.sh firefox   -> builds confluencex-firefox.zip
#   ./build.sh all       -> builds both
#
# Requirements: zip (standard on macOS/Linux)

set -e

TARGET=${1:-chrome}
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"

build_target() {
  local target=$1
  local dist="$DIST_DIR/$target"
  local zip_file="$ROOT_DIR/confluencex-${target}.zip"

  echo "Building for $target..."
  rm -rf "$dist"
  mkdir -p "$dist"

  # Copy all source files (excluding build artifacts and dev files)
  rsync -a --exclude='dist/' \
           --exclude='*.zip' \
           --exclude='.DS_Store' \
           --exclude='node_modules/' \
           --exclude='.git/' \
           --exclude='build.sh' \
           --exclude='manifest.chrome.json' \
           --exclude='manifest.firefox.json' \
           "$ROOT_DIR/" "$dist/"

  # Copy the correct manifest
  cp "$ROOT_DIR/manifest.${target}.json" "$dist/manifest.json"

  # Firefox-specific: create background.html
  if [ "$target" = "firefox" ]; then
    mkdir -p "$dist/background"
    cat > "$dist/background/background.html" << 'BGEOF'
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script src="../shared/browser-polyfill.js"></script>
  <script src="../shared/constants.js"></script>
  <script src="../shared/message-types.js"></script>
  <script src="../shared/confluence-api.js"></script>
  <script src="../shared/ai-client.js"></script>
  <script src="../shared/storage.js"></script>
  <script src="../shared/xml-utils.js"></script>
  <script src="service-worker.js"></script>
</head>
<body></body>
</html>
BGEOF
    echo "  Created Firefox background.html"
  fi

  # Create the zip
  rm -f "$zip_file"
  cd "$dist"
  zip -r "$zip_file" . -x "*.DS_Store" -x "__MACOSX/*" > /dev/null
  cd "$ROOT_DIR"

  local size
  size=$(du -sh "$zip_file" | cut -f1)
  echo "  Built: $zip_file ($size)"
}

case "$TARGET" in
  chrome)
    build_target chrome
    ;;
  firefox)
    build_target firefox
    ;;
  all)
    build_target chrome
    build_target firefox
    ;;
  *)
    echo "Usage: ./build.sh [chrome|firefox|all]"
    exit 1
    ;;
esac

echo "Done!"
