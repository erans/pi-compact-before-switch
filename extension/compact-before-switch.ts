/**
 * pi extension: compact context with the outgoing model before switching to
 * a smaller-context model via /model. See
 * docs/superpowers/specs/2026-06-15-compact-before-switch-design.md
 */

import type { ExtensionAPI, Model } from "@earendil-works/pi-coding-agent";

export type ModelSelectSource = "set" | "cycle" | "restore";

export interface CompactBeforeSwitchEvent {
	model: Model<any>;
	previousModel: Model<any> | undefined;
	source: ModelSelectSource;
}

interface GuardState {
	active: boolean;
	pendingTarget: Model<any> | null;
	guardTimer: ReturnType<typeof setTimeout> | null;
}

const RESERVE_TOKENS = 16_384;
const GUARD_TIMEOUT_MS = 30_000;

/**
 * Pure trigger filter. Returns true iff this model_select event should
 * prompt the user to compact before switching.
 *
 * Trigger conditions (all must hold):
 *   1. source === "set"   (skip Ctrl+P cycling and session restore)
 *   2. previousModel defined (no first-selection prompt)
 *   3. model differs from previousModel by id AND provider
 *   4. model.contextWindow < previousModel.contextWindow (narrowing)
 *   5. currentTokens > model.contextWindow - reserve
 */
export function shouldCompactBeforeSwitch(
	event: CompactBeforeSwitchEvent,
	getTokenCount: () => number | null | undefined,
	reserveTokens: number = RESERVE_TOKENS,
): boolean {
	const { model, previousModel, source } = event;

	// 1. Skip cycling and session restore; only intercept explicit /model picks.
	if (source !== "set") return false;
	// 2. Ignore first selection (no previous model to compact with).
	if (!previousModel) return false;
	// 3. Ignore same-model re-selects.
	if (model.id === previousModel.id && model.provider === previousModel.provider) return false;
	// 4. Only intervene on window narrowing.
	if (model.contextWindow >= previousModel.contextWindow) return false;
	// 5. Only if current tokens exceed target window minus reserve.
	const tokens = getTokenCount() ?? 0;
	if (tokens <= model.contextWindow - reserveTokens) return false;

	return true;
}

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
	const stateRef: GuardState = {
		active: false,
		pendingTarget: null,
		guardTimer: null,
	};

	pi.on("model_select", async (event, ctx) => {
		if (stateRef.active) return; // reentrancy guard

		const usage = ctx.getContextUsage();
		if (!shouldCompactBeforeSwitch(event, () => usage?.tokens)) return;

		const { model, previousModel } = event;
		const tokens = usage?.tokens ?? 0;

		if (!ctx.hasUI) return; // path [C]: no UI (print mode), fall through silently for now

		const confirmed = await ctx.ui.confirm(
			"Compact before switching?",
			formatConfirmBody(tokens, previousModel, model),
		);
		if (confirmed) {
			const revertOk = await pi.setModel(previousModel);
			if (!revertOk) {
				ctx.ui.notify(
					`No API key for ${previousModel.provider}/${previousModel.id}. Switch canceled; staying on ${model.provider}/${model.id}.`,
					"error",
				);
				return;
			}

			stateRef.pendingTarget = model;
			setActive(stateRef, true, () => {
				ctx.ui.notify(
					"Compact before switch timed out — pick a model again when ready.",
					"warning",
				);
			});

			ctx.ui.notify(
				`Compacting with ${previousModel.provider}/${previousModel.id} before switch…`,
				"info",
			);

			ctx.compact({
				onComplete: async () => {
					try {
						const target = stateRef.pendingTarget ?? model;
						const reapplyOk = await pi.setModel(target);
						if (!reapplyOk) {
							ctx.ui.notify(
								`Switch to ${target.provider}/${target.id} failed; staying on ${previousModel.provider}/${previousModel.id}.`,
								"error",
							);
							return;
						}
						ctx.ui.notify(`Compacted — switched to ${target.provider}/${target.id}`, "info");
					} finally {
						setActive(stateRef, false, () => {});
						stateRef.pendingTarget = null;
					}
				},
				onError: (err) => {
					setActive(stateRef, false, () => {});
					stateRef.pendingTarget = null;
					ctx.ui.notify(
						`Compact failed: ${err.message}. Staying on ${previousModel.provider}/${previousModel.id}.`,
						"error",
					);
				},
			});
		} else {
			const revertOk = await pi.setModel(previousModel);
			try {
				if (!revertOk) {
					ctx.ui.notify(
						`Switch canceled but could not revert to ${previousModel.provider}/${previousModel.id}; staying on ${model.provider}/${model.id}.`,
						"warning",
					);
					return;
				}
				ctx.ui.notify(
					`Switch canceled. Context still too large for ${model.provider}/${model.id}. Run /compact manually when ready.`,
					"info",
				);
			} finally {
				// Always clear guard state so the next genuine /model press is not swallowed.
				setActive(stateRef, false, () => {});
				stateRef.pendingTarget = null;
			}
		}
	});
}
