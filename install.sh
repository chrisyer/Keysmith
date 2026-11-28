#!/bin/sh
set -eu

REPO="chrisyer/Keysmith"
OS="$(uname -s)"

resolve_version() {
  ver="${KEYSMITH_VERSION:-}"
  if [ -z "$ver" ]; then
    tag="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
      | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    ver="${tag#v}"
  fi
  ver="${ver#v}"
  if [ -z "$ver" ]; then
    echo "Error: Failed to resolve latest Keysmith version from GitHub." >&2
    exit 1
  fi
  printf '%s' "$ver"
}

if [ "$OS" = "Darwin" ]; then
  APP_NAME="Keysmith.app"
  DEST_DIR="/Applications"
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

  VERSION="$(resolve_version)"
  DMG_NAME="Keysmith_${VERSION}_${ARCH}.dmg"
  BASE_URL="https://github.com/$REPO/releases/download/v${VERSION}"
  TMP_DIR="$(mktemp -d)"
  MOUNT_DIR="$TMP_DIR/mnt"
  DMG_PATH="$TMP_DIR/$DMG_NAME"
  SUMS_PATH="$TMP_DIR/SHA256SUMS.txt"

  cleanup_darwin() {
    if [ -d "$MOUNT_DIR" ]; then
      hdiutil detach "$MOUNT_DIR" -quiet 2>/dev/null || true
    fi
    rm -rf "$TMP_DIR"
  }
  trap cleanup_darwin EXIT INT TERM

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

elif [ "$OS" = "Linux" ]; then
  ARCH_RAW="$(uname -m)"
  if [ "$ARCH_RAW" != "x86_64" ] && [ "$ARCH_RAW" != "amd64" ]; then
    echo "Error: Prebuilt Linux releases currently support x86_64/amd64 only (got $ARCH_RAW)." >&2
    exit 1
  fi

  VERSION="$(resolve_version)"
  BASE_URL="https://github.com/$REPO/releases/download/v${VERSION}"
  TMP_DIR="$(mktemp -d)"
  SUMS_PATH="$TMP_DIR/SHA256SUMS.txt"

  cleanup_linux() {
    rm -rf "$TMP_DIR"
  }
  trap cleanup_linux EXIT INT TERM

  if ! curl -fsSL "$BASE_URL/SHA256SUMS.txt" -o "$SUMS_PATH"; then
    echo "Error: Failed to download SHA256SUMS.txt from $BASE_URL/SHA256SUMS.txt" >&2
    exit 1
  fi

  APPIMAGE_NAME="$(awk -v expected="Keysmith_${VERSION}_amd64.AppImage" '$2 == expected { print $2; exit }' "$SUMS_PATH")"
  if [ -z "$APPIMAGE_NAME" ]; then
    APPIMAGE_NAME="$(awk '/\.AppImage$/ { print $2; exit }' "$SUMS_PATH")"
  fi
  if [ -z "$APPIMAGE_NAME" ]; then
    echo "Error: No Linux .AppImage asset found in v${VERSION} SHA256SUMS.txt." >&2
    echo "For Debian/Ubuntu (.deb) or Fedora/RHEL (.rpm), download packages from:" >&2
    echo "  https://github.com/$REPO/releases/tag/v${VERSION}" >&2
    exit 1
  fi

  APPIMAGE_PATH="$TMP_DIR/$APPIMAGE_NAME"
  echo "Downloading Keysmith v${VERSION} ($APPIMAGE_NAME)..."
  curl -fL --progress-bar "$BASE_URL/$APPIMAGE_NAME" -o "$APPIMAGE_PATH"

  EXPECTED_SHA="$(awk -v name="$APPIMAGE_NAME" '$2 == name { print $1 }' "$SUMS_PATH" | head -n 1)"
  if [ -z "$EXPECTED_SHA" ]; then
    echo "Error: SHA-256 entry for $APPIMAGE_NAME not found in SHA256SUMS.txt" >&2
    exit 1
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_SHA="$(sha256sum "$APPIMAGE_PATH" | awk '{ print $1 }')"
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL_SHA="$(shasum -a 256 "$APPIMAGE_PATH" | awk '{ print $1 }')"
  else
    echo "Error: Neither sha256sum nor shasum is installed." >&2
    exit 1
  fi

  if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
    echo "Error: SHA-256 mismatch for $APPIMAGE_NAME" >&2
    echo "  expected: $EXPECTED_SHA" >&2
    echo "  actual:   $ACTUAL_SHA" >&2
    exit 1
  fi
  echo "Verified SHA-256: $ACTUAL_SHA"

  BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
  DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
  APPS_DIR="$DATA_DIR/applications"
  DEST_BIN="$BIN_DIR/keysmith"
  DESKTOP_FILE="$APPS_DIR/keysmith.desktop"

  mkdir -p "$BIN_DIR" "$APPS_DIR"
  chmod 0755 "$APPIMAGE_PATH"
  mv "$APPIMAGE_PATH" "$DEST_BIN"

  cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Keysmith
Comment=Local-first zero-knowledge password & passkey manager
Exec="${DEST_BIN}" %u
Icon=keysmith
Terminal=false
Categories=Utility;Security;
StartupWMClass=Keysmith
MimeType=x-scheme-handler/keysmith;
EOF

  echo "Installed Keysmith AppImage to $DEST_BIN"
  echo "Created desktop entry at $DESKTOP_FILE"
  echo ""
  echo "Notes:"
  echo "  - Ensure $BIN_DIR is in your PATH to run 'keysmith' from a terminal."
  echo "  - For native .deb/.rpm packages (includes bundled Polkit policy), download from GitHub Releases."
  echo "  - Optional tools: wtype/ydotool + grim (Wayland) or xdotool + scrot/import (X11) for Auto-Type & QR screen scan."

else
  echo "Error: Unsupported OS '$OS'. Download Windows installers from https://github.com/$REPO/releases" >&2
  exit 1
fi
