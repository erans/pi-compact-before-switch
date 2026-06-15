/**
 * pi extension: compact context with the outgoing model before switching to
 * a smaller-context model via /model. See
 * docs/superpowers/specs/2026-06-15-compact-before-switch-design.md
 */

import type { ExtensionAPI, Model } from "@earendil-works/pi-coding-agent";

const RESERVE_TOKENS = 16_384;
const GUARD_TIMEOUT_MS = 30_000;

export default function (pi: ExtensionAPI): void {
	// Placeholder: handler will be wired in Task 3.
}
