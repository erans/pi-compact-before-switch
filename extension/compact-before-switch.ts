/**
 * pi extension: compact context with the outgoing model before switching to
 * a smaller-context model via /model. See
 * docs/superpowers/specs/2026-06-15-compact-before-switch-design.md
 */

import type { ExtensionAPI, Model } from "@earendil-works/pi-coding-agent";

const RESERVE_TOKENS = 16_384;
const GUARD_TIMEOUT_MS = 30_000;

function formatConfirmBody(
	tokens: number,
	previousModel: Model<any>,
	newModel: Model<any>,
): string {
	return [
		`Context: ${tokens.toLocaleString()} tokens`,
		`Target window (${newModel.provider}/${newModel.id}): ${newModel.contextWindow.toLocaleString()}`,
		`Source window (${previousModel.provider}/${previousModel.id}): ${previousModel.contextWindow.toLocaleString()}`,
		"",
		`Compact with ${previousModel.id} first, then switch.`,
	].join("\n");
}

interface GuardState {
	active: boolean;
	pendingTarget: Model<any> | null;
	guardTimer: ReturnType<typeof setTimeout> | null;
}

function setActive(state: GuardState, value: boolean, onTimeout: () => void): void {
	state.active = value;
	if (state.guardTimer) {
		clearTimeout(state.guardTimer);
		state.guardTimer = null;
	}
	if (value) {
		state.guardTimer = setTimeout(() => {
			state.active = false;
			state.pendingTarget = null;
			state.guardTimer = null;
			onTimeout();
		}, GUARD_TIMEOUT_MS);
	}
}

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

		if (!ctx.hasUI) return; // path [C]: no UI (print mode), fall through silently for now

		const confirmed = await ctx.ui.confirm(
			"Compact before switching?",
			formatConfirmBody(tokens, previousModel, model),
		);
		if (confirmed) {
			// Path [A]: confirm. Built in Task 6.
		} else {
			// Path [B]: cancel. Built in Task 7.
		}
	});
}
