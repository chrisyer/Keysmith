#!/bin/sh
set -eu

REPO="chrisyer/Keysmith"
APP_NAME="Keysmith.app"
DEST_DIR="/Applications"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Error: Keysmith installer currently supports macOS only." >&2
  exit 1
fi

ARCH_RAW="$(uname -m)"
if [ "$ARCH_RAW" = "arm64" ]; then
  ARCH="aarch64"
elif [ "$ARCH_RAW" = "x86_64" ]; then
  if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
    ARCH="aarch64"
  else
    ARCH="x64"
  fi
else
  echo "Error: Unsupported macOS architecture: $ARCH_RAW" >&2
  exit 1
fi

VERSION="${KEYSMITH_VERSION:-}"
if [ -z "$VERSION" ]; then
  TAG="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  VERSION="${TAG#v}"
fi
VERSION="${VERSION#v}"

if [ -z "$VERSION" ]; then
  echo "Error: Failed to resolve latest Keysmith version from GitHub." >&2
  exit 1
fi

DMG_NAME="Keysmith_${VERSION}_${ARCH}.dmg"
BASE_URL="https://github.com/$REPO/releases/download/v${VERSION}"
TMP_DIR="$(mktemp -d)"
MOUNT_DIR="$TMP_DIR/mnt"
DMG_PATH="$TMP_DIR/$DMG_NAME"
SUMS_PATH="$TMP_DIR/SHA256SUMS.txt"

cleanup() {
  if [ -d "$MOUNT_DIR" ]; then
    hdiutil detach "$MOUNT_DIR" -quiet 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

echo "Downloading Keysmith v${VERSION} (${ARCH})..."
curl -fL --progress-bar "$BASE_URL/$DMG_NAME" -o "$DMG_PATH"

if ! curl -fsSL "$BASE_URL/SHA256SUMS.txt" -o "$SUMS_PATH"; then
  echo "Error: Failed to download SHA256SUMS.txt from $BASE_URL/SHA256SUMS.txt" >&2
  exit 1
fi

EXPECTED_SHA="$(awk -v name="$DMG_NAME" '$2 == name { print $1 }' "$SUMS_PATH" | head -n 1)"
if [ -z "$EXPECTED_SHA" ]; then
  echo "Error: SHA-256 entry for $DMG_NAME not found in SHA256SUMS.txt" >&2
  exit 1
fi

ACTUAL_SHA="$(shasum -a 256 "$DMG_PATH" | awk '{ print $1 }')"
if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
  echo "Error: SHA-256 mismatch for $DMG_NAME" >&2
  echo "  expected: $EXPECTED_SHA" >&2
  echo "  actual:   $ACTUAL_SHA" >&2
  exit 1
fi
echo "Verified SHA-256: $ACTUAL_SHA"

mkdir -p "$MOUNT_DIR"
hdiutil attach "$DMG_PATH" -nobrowse -quiet -mountpoint "$MOUNT_DIR"

if [ ! -d "$MOUNT_DIR/$APP_NAME" ]; then
  echo "Error: $APP_NAME not found in $DMG_NAME" >&2
  exit 1
fi

pkill -x keysmith-desktop 2>/dev/null || true
rm -rf "$DEST_DIR/$APP_NAME"
ditto "$MOUNT_DIR/$APP_NAME" "$DEST_DIR/$APP_NAME"

echo "Installed $APP_NAME to $DEST_DIR/$APP_NAME"
echo ""
echo "Note: Keysmith builds are currently ad-hoc signed without Apple Developer notarization."
echo "If macOS Gatekeeper blocks first launch, approve it via:"
echo "  System Settings -> Privacy & Security -> Open Anyway"
echo "Or manually clear the quarantine attribute after verifying the release checksum:"
echo "  xattr -dr com.apple.quarantine \"$DEST_DIR/$APP_NAME\""
open -a "$DEST_DIR/$APP_NAME" || true
