/**
 * Pure-function tests for the trigger filter.
 * Run with: node --test --experimental-strip-types tests/trigger.test.ts
 */

// Ensure the PI_DEBUG_CBS env var leaks from the developer's shell do not
// turn on diagnostic emits inside the extension under test.
delete process.env.PI_DEBUG_CBS;

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	shouldCompactBeforeSwitch,
	type CompactBeforeSwitchEvent,
} from "../extensions/compact-before-switch.ts";

type Model = CompactBeforeSwitchEvent["model"];

function m(provider: string, id: string, contextWindow: number): Model {
	return { provider, id, contextWindow } as Model;
}

const OPUS_1M = m("anthropic", "claude-opus-4-5", 1_000_000);
const HAIKU_200K = m("anthropic", "claude-haiku-4-5", 200_000);
const OPUS_1M_DUP = m("anthropic", "claude-opus-4-5", 1_000_000); // same as OPUS_1M
const GPT_400K = m("openai", "gpt-5", 400_000); // also narrower than OPUS_1M

test("triggers: Opus → Haiku with overflow", () => {
	const event = { model: HAIKU_200K, previousModel: OPUS_1M, source: "set" as const };
	const result = shouldCompactBeforeSwitch(event, () => 300_000);
	assert.equal(result, true);
});

test("triggers at boundary: tokens == window - reserve + 1 → triggers", () => {
	const event = { model: HAIKU_200K, previousModel: OPUS_1M, source: "set" as const };
	// HAIKU_200K.contextWindow - RESERVE = 200_000 - 16_384 = 183_616
	assert.equal(shouldCompactBeforeSwitch(event, () => 183_617), true);
});

test("does not trigger at boundary: tokens == window - reserve", () => {
	const event = { model: HAIKU_200K, previousModel: OPUS_1M, source: "set" as const };
	assert.equal(shouldCompactBeforeSwitch(event, () => 183_616), false);
});

test("does not trigger when tokens below target window minus reserve", () => {
	const event = { model: HAIKU_200K, previousModel: OPUS_1M, source: "set" as const };
	assert.equal(shouldCompactBeforeSwitch(event, () => 80_000), false);
});

test("does not trigger when tokens are zero", () => {
	const event = { model: HAIKU_200K, previousModel: OPUS_1M, source: "set" as const };
	assert.equal(shouldCompactBeforeSwitch(event, () => 0), false);
});

test("does not trigger when token count is null", () => {
	const event = { model: HAIKU_200K, previousModel: OPUS_1M, source: "set" as const };
	assert.equal(shouldCompactBeforeSwitch(event, () => null), false);
});

test("does not trigger when token count is undefined", () => {
	const event = { model: HAIKU_200K, previousModel: OPUS_1M, source: "set" as const };
	assert.equal(shouldCompactBeforeSwitch(event, () => undefined), false);
});

test("skips cycle source", () => {
	const event = { model: HAIKU_200K, previousModel: OPUS_1M, source: "cycle" as const };
	assert.equal(shouldCompactBeforeSwitch(event, () => 300_000), false);
});

test("skips restore source", () => {
	const event = { model: HAIKU_200K, previousModel: OPUS_1M, source: "restore" as const };
	assert.equal(shouldCompactBeforeSwitch(event, () => 300_000), false);
});

test("skips first selection (no previousModel)", () => {
	const event = { model: HAIKU_200K, previousModel: undefined, source: "set" as const };
	assert.equal(shouldCompactBeforeSwitch(event, () => 300_000), false);
});

test("skips same-model re-select (same provider and id)", () => {
	const event = { model: OPUS_1M, previousModel: OPUS_1M_DUP, source: "set" as const };
	assert.equal(shouldCompactBeforeSwitch(event, () => 500_000), false);
});

test("triggers when id matches but provider differs (cross-provider narrowing)", () => {
	// Hypothetical edge: same id from two providers with different windows.
	const A = m("provider-a", "shared-model", 1_000_000);
	const B = m("provider-b", "shared-model", 100_000);
	assert.equal(
		shouldCompactBeforeSwitch({ model: B, previousModel: A, source: "set" }, () => 150_000),
		true,
	);
});

test("skips on window widening", () => {
	const event = { model: OPUS_1M, previousModel: HAIKU_200K, source: "set" as const };
	assert.equal(shouldCompactBeforeSwitch(event, () => 100_000), false);
});

test("skips when new and previous model have identical contextWindow", () => {
	const event = { model: OPUS_1M, previousModel: OPUS_1M, source: "set" as const };
	assert.equal(shouldCompactBeforeSwitch(event, () => 500_000), false);
});

test("respects custom reserve tokens: smaller reserve fires at smaller token counts", () => {
	const event = { model: HAIKU_200K, previousModel: OPUS_1M, source: "set" as const };
	// Default reserve: tokens must exceed 200_000 - 16_384 = 183_616
	assert.equal(shouldCompactBeforeSwitch(event, () => 100_000), false);
	assert.equal(shouldCompactBeforeSwitch(event, () => 183_616), false);
	assert.equal(shouldCompactBeforeSwitch(event, () => 183_617), true);
	// reserve = 100_000: tokens must exceed 100_000
	assert.equal(shouldCompactBeforeSwitch(event, () => 100_000, 100_000), false);
	assert.equal(shouldCompactBeforeSwitch(event, () => 100_001, 100_000), true);
	// reserve = 0: tokens must exceed 200_000
	assert.equal(shouldCompactBeforeSwitch(event, () => 200_000, 0), false);
	assert.equal(shouldCompactBeforeSwitch(event, () => 200_001, 0), true);
});

test("does not call getTokenCount when earlier conditions fail", () => {
	let called = false;
	const get = () => {
		called = true;
		return 999_999;
	};
	// cycle -> early return before token check
	shouldCompactBeforeSwitch({ model: HAIKU_200K, previousModel: OPUS_1M, source: "cycle" }, get);
	assert.equal(called, false);
});

test("does not call getTokenCount when no previousModel", () => {
	let called = false;
	const get = () => {
		called = true;
		return 999_999;
	};
	shouldCompactBeforeSwitch({ model: HAIKU_200K, previousModel: undefined, source: "set" }, get);
	assert.equal(called, false);
});

test("does not call getTokenCount when same model re-selected", () => {
	let called = false;
	const get = () => {
		called = true;
		return 999_999;
	};
	shouldCompactBeforeSwitch({ model: OPUS_1M, previousModel: OPUS_1M_DUP, source: "set" }, get);
	assert.equal(called, false);
});

test("does not call getTokenCount when widening", () => {
	let called = false;
	const get = () => {
		called = true;
		return 0;
	};
	shouldCompactBeforeSwitch({ model: OPUS_1M, previousModel: HAIKU_200K, source: "set" }, get);
	assert.equal(called, false);
});

test("does call getTokenCount when first four conditions pass", () => {
	let called = false;
	const get = () => {
		called = true;
		return 50_000;
	};
	shouldCompactBeforeSwitch({ model: HAIKU_200K, previousModel: OPUS_1M, source: "set" }, get);
	assert.equal(called, true);
});

test("triggers when Opus → GPT-400K with overflow", () => {
	assert.equal(
		shouldCompactBeforeSwitch({ model: GPT_400K, previousModel: OPUS_1M, source: "set" }, () => 500_000),
		true,
	);
});
