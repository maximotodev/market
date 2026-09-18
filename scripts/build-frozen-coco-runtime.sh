#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_ROOT="$PROJECT_ROOT/scripts/coco-runtime"
OUTPUT_ROOT="$PROJECT_ROOT/vendor/coco-runtime-190b25b0"
COCO_SOURCE="${COCO_SOURCE:-/home/maximoto/dev/coco-p2pk-refund-implement-01}"
COCO_COMMIT="190b25b0c16eb6ebbb42e1d67a0d28399c641ae1"
EXPECTED_BUN_VERSION="1.3.11"

if [ "$(git -C "$COCO_SOURCE" rev-parse HEAD)" != "$COCO_COMMIT" ]; then
	echo "Coco source is not at required commit $COCO_COMMIT" >&2
	exit 1
fi

if [ "$(bun --version)" != "$EXPECTED_BUN_VERSION" ]; then
	echo "Bun $EXPECTED_BUN_VERSION is required for deterministic output" >&2
	exit 1
fi

BUILD_ROOT="$(mktemp -d)"
trap 'rm -rf "$BUILD_ROOT"' EXIT

mkdir -p "$BUILD_ROOT/coco" "$BUILD_ROOT/output"
git -C "$COCO_SOURCE" archive --format=tar "$COCO_COMMIT" -o "$BUILD_ROOT/coco.tar"
tar -xf "$BUILD_ROOT/coco.tar" -C "$BUILD_ROOT/coco"

(
	cd "$BUILD_ROOT/coco"
	bun install --frozen-lockfile
	bun run --filter='@cashu/coco-core' build
	bun run --filter='@cashu/coco-indexeddb' build
)

bun "$TEMPLATE_ROOT/prepare-packages.ts" "$BUILD_ROOT/coco" "$BUILD_ROOT/output"

bun "$TEMPLATE_ROOT/verify-manifest.ts" "$TEMPLATE_ROOT/manifest.json" "$BUILD_ROOT/output"

rm -rf "$OUTPUT_ROOT"
mkdir -p "$(dirname "$OUTPUT_ROOT")"
cp -R "$BUILD_ROOT/output" "$OUTPUT_ROOT"

echo "Built deterministic Coco runtime at $OUTPUT_ROOT"
