#!/usr/bin/env bash
# Launch pi with the canonical extension loaded, fresh session.
# Args after `--` are forwarded to pi (e.g. `--model anthropic/claude-sonnet-4-5`).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
exec pi -e "$REPO_DIR/extensions/compact-before-switch.ts" "$@"
