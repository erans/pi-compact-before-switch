/**
 * pi extension: compact context with the outgoing model before switching to
 * a smaller-context model via /model. See
 * docs/superpowers/specs/2026-06-15-compact-before-switch-design.md
 */

import type { ExtensionAPI, Model } from "@earendil-works/pi-coding-agent";

const RESERVE_TOKENS = 16_384;
const GUARD_TIMEOUT_MS = 30_000;

export default function (pi: ExtensionAPI): void {
	let active = false;
	let pendingTarget: Model<any> | null = null;
	let guardTimer: ReturnType<typeof setTimeout> | null = null;

	pi.on("model_select", async (event, ctx) => {
		if (active) return; // reentrancy guard

		const { model, previousModel, source } = event;

		// Trigger condition 1: skip Ctrl+P cycling.
		if (source === "cycle") return;
		// Trigger condition 2: ignore first selection.
		if (!previousModel) return;
		// Trigger condition 3: ignore same-model re-select.
		if (model.id === previousModel.id && model.provider === previousModel.provider) return;
		// Trigger condition 4: only intervene on window narrowing.
		if (model.contextWindow >= previousModel.contextWindow) return;

		// Trigger condition 5: only if current tokens exceed target window minus reserve.
		const usage = ctx.getContextUsage();
		const tokens = usage?.tokens ?? 0;
		if (tokens <= model.contextWindow - RESERVE_TOKENS) return;

		// Confirm-only path comes next; no programmatic test possible here.
	});
}
