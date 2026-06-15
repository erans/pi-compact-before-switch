#!/usr/bin/env bash
# Run the smoke test suite. Uses node --test (Node 22+) with TypeScript via --experimental-strip-types.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
exec node --test --experimental-strip-types --no-warnings --test-force-exit \
	"$REPO_DIR/tests/"*.test.ts
