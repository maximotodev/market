#!/usr/bin/env bash
# Start the controlled local CDK mint used by Coco browser tests.
#
# Required environment:
#   CDK_MINTD_BIN       Path to the cdk-mintd executable, unless it is on PATH.
#   CDK_MINTD_MNEMONIC  Test-only mint mnemonic. It is never printed.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MINT_DIR="${CASHU_MINT_DIR:-/tmp/cdk-mint-e2e}"
MINT_PORT="${CASHU_MINT_PORT:-3338}"
MINT_HOST="${CASHU_MINT_HOST:-127.0.0.1}"
if [ -n "${CDK_MINTD_BIN:-}" ]; then
	CDK_MINTD_BIN="$CDK_MINTD_BIN"
elif command -v cdk-mintd >/dev/null 2>&1; then
	CDK_MINTD_BIN="$(command -v cdk-mintd)"
else
	CDK_MINTD_BIN="$(bash "$PROJECT_ROOT/scripts/bootstrap-cdk-mintd.sh")"
fi

if [ -z "$CDK_MINTD_BIN" ] || [ ! -x "$CDK_MINTD_BIN" ]; then
	echo "ERROR: pinned cdk-mintd bootstrap did not produce an executable binary." >&2
	exit 1
fi

if [ "$("$CDK_MINTD_BIN" --version)" != "cdk-mintd 0.17.0-rc.0" ]; then
	echo "ERROR: controlled demo requires cdk-mintd 0.17.0-rc.0." >&2
	exit 1
fi

if [ -z "${CDK_MINTD_MNEMONIC:-}" ]; then
	echo "ERROR: CDK_MINTD_MNEMONIC is required for the controlled test mint." >&2
	exit 1
fi

mkdir -p "$MINT_DIR"

export CDK_MINTD_DATABASE=sqlite
export CDK_MINTD_LN_BACKEND=fakewallet
export CDK_MINTD_INPUT_FEE_PPK=0
export CDK_MINTD_LISTEN_HOST="$MINT_HOST"
export CDK_MINTD_LISTEN_PORT="$MINT_PORT"
export CDK_MINTD_URL="http://localhost:$MINT_PORT/"
export CDK_MINTD_FAKE_WALLET_SUPPORTED_UNITS=sat
export CDK_MINTD_FAKE_WALLET_FEE_PERCENT=0
export CDK_MINTD_FAKE_WALLET_RESERVE_FEE_MIN=0
export CDK_MINTD_FAKE_WALLET_MIN_DELAY=0
export CDK_MINTD_FAKE_WALLET_MAX_DELAY=0

exec "$CDK_MINTD_BIN" --work-dir "$MINT_DIR"
