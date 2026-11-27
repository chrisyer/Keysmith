#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"

PROFILE="release"
CARGO_FLAG="--release"
SIM_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --debug)
      PROFILE="debug"
      CARGO_FLAG=""
      ;;
    --release)
      PROFILE="release"
      CARGO_FLAG="--release"
      ;;
    --sim-only)
      SIM_ONLY=1
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: $0 [--debug|--release] [--sim-only]" >&2
      exit 1
      ;;
  esac
done

BINDINGS_DIR="$ROOT_DIR/apps/ios/Shared/Bindings"
HEADERS_DIR="$BINDINGS_DIR/Headers"
OUT_XCFRAMEWORK="$ROOT_DIR/apps/ios/Frameworks/KeysmithCore.xcframework"
TEMP_BINDGEN_OUT="$(mktemp -d "${TMPDIR:-/tmp}/keysmith-uniffi.XXXXXX")"
trap 'rm -rf "$TEMP_BINDGEN_OUT"' EXIT

# Ensure iOS deployment target matches Xcode project (iOS 26.0, falling back smoothly if needed)
export IPHONEOS_DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-17.0}"

echo "==> Building keysmith-ffi ($PROFILE) for aarch64-apple-ios-sim..."
cargo build -p keysmith-ffi --target aarch64-apple-ios-sim $CARGO_FLAG

SIM_LIB="$ROOT_DIR/target/aarch64-apple-ios-sim/$PROFILE/libkeysmith_ffi.a"
if [[ ! -f "$SIM_LIB" ]]; then
  echo "Missing built simulator library: $SIM_LIB" >&2
  exit 1
fi

DEVICE_LIB="$ROOT_DIR/target/aarch64-apple-ios/$PROFILE/libkeysmith_ffi.a"
if [[ "$SIM_ONLY" -eq 0 ]]; then
  echo "==> Building keysmith-ffi ($PROFILE) for aarch64-apple-ios..."
  cargo build -p keysmith-ffi --target aarch64-apple-ios $CARGO_FLAG
  if [[ ! -f "$DEVICE_LIB" ]]; then
    echo "Missing built device library: $DEVICE_LIB" >&2
    exit 1
  fi
fi

echo "==> Generating Swift bindings via uniffi-bindgen..."
mkdir -p "$BINDINGS_DIR" "$HEADERS_DIR"
rm -rf "$HEADERS_DIR"/*

cargo run -p keysmith-ffi --bin uniffi-bindgen -- \
  generate \
  --library "$SIM_LIB" \
  --language swift \
  --out-dir "$TEMP_BINDGEN_OUT"

SWIFT_FILE="$(find "$TEMP_BINDGEN_OUT" -maxdepth 1 -name '*.swift' | head -n 1)"
if [[ -z "$SWIFT_FILE" ]]; then
  echo "No .swift binding generated in $TEMP_BINDGEN_OUT" >&2
  exit 1
fi
cp "$SWIFT_FILE" "$BINDINGS_DIR/KeysmithFFI.swift"

# Patch uniffi-bindgen 0.28.3 Swift output for Swift 6 strict concurrency (`SWIFT_STRICT_CONCURRENCY = complete`)
python3 - "$BINDINGS_DIR/KeysmithFFI.swift" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

src = src.replace(
    "fileprivate class UniffiHandleMap<T> {",
    "fileprivate final class UniffiHandleMap<T>: @unchecked Sendable {",
)
src = src.replace(
    "    static var vtable:",
    "    nonisolated(unsafe) static var vtable:",
)
src = src.replace(
    "    fileprivate static var handleMap =",
    "    fileprivate static let handleMap =",
)
src = src.replace(
    "private var initializationResult: InitializationResult =",
    "private let initializationResult: InitializationResult =",
)
if "extension KeysmithCoreHandle: @unchecked Sendable" not in src:
    src = src.replace(
        "// swiftlint:enable all",
        "extension KeysmithCoreHandle: @unchecked Sendable {}\n\n// swiftlint:enable all",
    )

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
PYEOF

HEADER_FILE="$(find "$TEMP_BINDGEN_OUT" -maxdepth 1 -name '*.h' | head -n 1)"
MODULEMAP_FILE="$(find "$TEMP_BINDGEN_OUT" -maxdepth 1 -name '*.modulemap' | head -n 1)"
if [[ -z "$HEADER_FILE" || -z "$MODULEMAP_FILE" ]]; then
  echo "Missing generated header or modulemap in $TEMP_BINDGEN_OUT" >&2
  exit 1
fi

cp "$HEADER_FILE" "$HEADERS_DIR/$(basename "$HEADER_FILE")"
cp "$MODULEMAP_FILE" "$HEADERS_DIR/module.modulemap"

echo "==> Packaging XCFramework at $OUT_XCFRAMEWORK..."
mkdir -p "$(dirname "$OUT_XCFRAMEWORK")"
rm -rf "$OUT_XCFRAMEWORK"

XCFRAMEWORK_ARGS=(
  -library "$SIM_LIB"
  -headers "$HEADERS_DIR"
)

if [[ "$SIM_ONLY" -eq 0 ]]; then
  XCFRAMEWORK_ARGS+=(
    -library "$DEVICE_LIB"
    -headers "$HEADERS_DIR"
  )
fi

xcodebuild -create-xcframework "${XCFRAMEWORK_ARGS[@]}" -output "$OUT_XCFRAMEWORK"

echo "==> Done!"
echo "    Swift bindings: $BINDINGS_DIR/KeysmithFFI.swift"
echo "    Headers:        $HEADERS_DIR/"
echo "    XCFramework:    $OUT_XCFRAMEWORK"
