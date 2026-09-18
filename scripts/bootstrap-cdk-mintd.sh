#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="0.17.0-rc.0"
TOOLS_ROOT="${LOCAL_TOOL_ROOT:-$PROJECT_ROOT/.local-tools}"
INSTALL_DIR="$TOOLS_ROOT/cdk-mintd/$VERSION"
INSTALL_BIN="$INSTALL_DIR/cdk-mintd"

case "$(uname -m)" in
	x86_64)
		ASSET="cdk-mintd-$VERSION-x86_64"
		EXPECTED_SHA256="d6868866b0b0873faa527d7cc949427c6e3d4e2a0b92b2ec6a99319c9f33eb29"
		;;
	aarch64 | arm64)
		ASSET="cdk-mintd-$VERSION-aarch64"
		EXPECTED_SHA256="f958ea46608accd1e3525ebb3469915a88143762c5e062191ecbd8d3bbdca3cf"
		;;
	*)
		echo "Unsupported architecture for pinned cdk-mintd: $(uname -m)" >&2
		exit 1
		;;
esac

verify_binary() {
	local candidate="$1"
	[ -x "$candidate" ] || return 1
	[ "$(sha256sum "$candidate" | cut -d ' ' -f 1)" = "$EXPECTED_SHA256" ] || return 1
	[ "$("$candidate" --version)" = "cdk-mintd $VERSION" ] || return 1
}

if ! verify_binary "$INSTALL_BIN"; then
	mkdir -p "$INSTALL_DIR"
	DOWNLOAD_DIR="$(mktemp -d "$INSTALL_DIR/.download.XXXXXX")"
	trap 'rm -rf "$DOWNLOAD_DIR"' EXIT
	DOWNLOAD_BIN="$DOWNLOAD_DIR/cdk-mintd"
	curl --fail --location --silent --show-error \
		"https://github.com/cashubtc/cdk/releases/download/v$VERSION/$ASSET" \
		--output "$DOWNLOAD_BIN"
	ACTUAL_SHA256="$(sha256sum "$DOWNLOAD_BIN" | cut -d ' ' -f 1)"
	if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
		echo "Pinned cdk-mintd digest mismatch: expected $EXPECTED_SHA256, got $ACTUAL_SHA256" >&2
		exit 1
	fi
	chmod 0755 "$DOWNLOAD_BIN"
	if [ "$("$DOWNLOAD_BIN" --version)" != "cdk-mintd $VERSION" ]; then
		echo "Downloaded binary did not report cdk-mintd $VERSION" >&2
		exit 1
	fi
	mv "$DOWNLOAD_BIN" "$INSTALL_BIN"
fi

printf '%s\n' "$INSTALL_BIN"
