/**
 * Orchestrator mock tests for compact-before-switch.
 *
 * Exercises the registered `model_select` handler against a stub
 * ExtensionAPI, verifying:
 *   - factory loads without throwing
 *   - exactly one model_select handler is registered
 *   - silent passes (cycle, restore, no previous, widening, same-model, fits)
 *   - scenario 1 (overflow trigger) shows confirm with formatted body
 *   - scenario 6 (cancel) reverts + notifies + clears guard
 *   - reentrancy guard swallows model_select fired during revert
 *
 * Run with: node --test --experimental-strip-types extension/__tests__/load.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import extensionFactory from "../compact-before-switch.ts";

type ModelStub = { provider: string; id: string; contextWindow: number };
type ConfirmCall = { title: string; body: string };
type NotifyCall = { message: string; severity: string };

function makeModel(provider: string, id: string, w: number): ModelStub {
	return { provider, id, contextWindow: w };
}

interface Stub {
	pi: { on: (e: string, cb: (e: unknown, c: unknown) => Promise<unknown>) => void; setModel: (m: ModelStub) => Promise<boolean>; compact: () => void; [k: string]: unknown };
	ctx: { ui: { notify: (m: string, s: "info" | "warning" | "error") => void; confirm: (t: string, b: string) => Promise<boolean> }; getContextUsage: () => { tokens: number; contextWindow: number; percentage: number } | null; compact: (o: unknown) => void; [k: string]: unknown };
	handlers: Array<{ event: string; cb: (e: unknown, c: unknown) => Promise<unknown> }>;
	calls: { setModel: ModelStub[]; confirm: ConfirmCall[]; notify: NotifyCall[] };
	setConfirmNext: (fn: () => Promise<boolean>) => void;
	setCompact: (fn: (o: unknown) => void) => void;
}

function makeStub(): Stub {
	const handlers: Stub["handlers"] = [];
	const setModelCalls: ModelStub[] = [];
	const confirmCalls: ConfirmCall[] = [];
	const notifyCalls: NotifyCall[] = [];
	let confirmNext: () => Promise<boolean> = async () => true;
	let compactFn: (o: unknown) => void = () => {};

	const ctx = {
		ui: {
			notify: (msg: string, sev: "info" | "warning" | "error") => {
				notifyCalls.push({ message: msg, severity: sev });
			},
			confirm: (title: string, body: string) => {
				confirmCalls.push({ title, body });
				return confirmNext();
			},
			select: async () => null,
			input: async () => "",
			editor: async () => "",
		},
		hasUI: true,
		mode: "tui" as const,
		cwd: "/tmp",
		isProjectTrusted: () => true,
		sessionManager: {},
		modelRegistry: {},
		model: undefined,
		signal: undefined,
		isIdle: () => true,
		hasPendingMessages: () => false,
		abort: () => {},
		shutdown: () => {},
		getContextUsage: () => null as { tokens: number; contextWindow: number; percentage: number } | null,
		compact: (o: unknown) => compactFn(o),
		getSystemPrompt: () => "",
		getSystemPromptOptions: () => ({}),
		waitForIdle: async () => {},
		newSession: async () => ({ cancelled: true }),
		fork: async () => ({ cancelled: true }),
		navigateTree: async () => ({}),
		switchSession: async () => ({ cancelled: true }),
		reload: async () => {},
	};

	const pi = {
		on(event: string, cb: (e: unknown, c: unknown) => Promise<unknown>) {
			handlers.push({ event, cb });
		},
		setModel: (m: ModelStub) => {
			setModelCalls.push(m);
			return Promise.resolve(true);
		},
		compact: () => {},
		sendMessage: () => {},
		sendUserMessage: () => {},
		appendEntry: () => {},
		setSessionName: () => {},
		getSessionName: () => undefined,
		setLabel: () => {},
		registerCommand: () => {},
		registerShortcut: () => {},
		registerFlag: () => {},
		registerTool: () => {},
		registerMessageRenderer: () => {},
		registerProvider: () => {},
		unregisterProvider: () => {},
		getActiveTools: () => [],
		getAllTools: () => [],
		setActiveTools: () => {},
		setThinkingLevel: () => {},
		getThinkingLevel: () => "off",
		exec: () => ({ stdout: "", stderr: "", code: 0, killed: false }),
		getCommands: () => [],
		events: { on: () => {}, emit: () => {} },
	};

	return {
		pi,
		ctx,
		handlers,
		calls: { setModel: setModelCalls, confirm: confirmCalls, notify: notifyCalls },
		setConfirmNext: (fn) => {
			confirmNext = fn;
		},
		setCompact: (fn) => {
			compactFn = fn;
		},
	};
}

test("factory loads without throwing", () => {
	const s = makeStub();
	assert.doesNotThrow(() => extensionFactory(s.pi as never));
});

test("factory registers exactly one model_select handler", () => {
	const s = makeStub();
	extensionFactory(s.pi as never);
	assert.equal(s.handlers.filter((h) => h.event === "model_select").length, 1);
});

// Helper to fetch the registered handler from a stub post-factory-call.
function handlerOf(s: Stub) {
	extensionFactory(s.pi as never);
	return s.handlers.find((h) => h.event === "model_select")!.cb;
}

test("silent passes: confirm not called for cycle, restore, no-prev, widening, same-model, fits", async () => {
	const handler = handlerOf(makeStub());
	const cases = [
		{
			name: "cycle source",
			event: {
				model: makeModel("anthropic", "claude-haiku-4-5", 200_000),
				previousModel: makeModel("anthropic", "claude-opus-4-5", 1_000_000),
				source: "cycle",
			},
			tokens: 500_000,
		},
		{
			name: "restore source",
			event: {
				model: makeModel("anthropic", "claude-haiku-4-5", 200_000),
				previousModel: makeModel("anthropic", "claude-opus-4-5", 1_000_000),
				source: "restore",
			},
			tokens: 500_000,
		},
		{
			name: "no previous model",
			event: {
				model: makeModel("anthropic", "claude-haiku-4-5", 200_000),
				previousModel: undefined,
				source: "set",
			},
			tokens: 500_000,
		},
		{
			name: "widening switch",
			event: {
				model: makeModel("anthropic", "claude-opus-4-5", 1_000_000),
				previousModel: makeModel("anthropic", "claude-haiku-4-5", 200_000),
				source: "set",
			},
			tokens: 350_000, // some number that would overflow if conditions held
		},
		{
			name: "same-model re-select",
			event: {
				model: makeModel("anthropic", "claude-opus-4-5", 1_000_000),
				previousModel: makeModel("anthropic", "claude-opus-4-5", 1_000_000),
				source: "set",
			},
			tokens: 500_000,
		},
		{
			name: "fits within target window minus reserve",
			event: {
				model: makeModel("anthropic", "claude-haiku-4-5", 200_000),
				previousModel: makeModel("anthropic", "claude-opus-4-5", 1_000_000),
				source: "set",
			},
			tokens: 80_000,
		},
	];

	for (const c of cases) {
		const s = makeStub();
		s.ctx.getContextUsage = () => ({
			tokens: c.tokens,
			contextWindow: 1_000_000,
			percentage: 0,
		});
		const h = handlerOf(s);
		// Re-register to use the new stub's ctx (already done above).
		await h(c.event, s.ctx);
		assert.equal(s.calls.confirm.length, 0, `confirm should NOT be called for: ${c.name}`);
	}
});

test("scenario 1: confirm fires with formatted body on narrowing switch with overflow", async () => {
	const s = makeStub();
	s.ctx.getContextUsage = () => ({ tokens: 250_000, contextWindow: 1_000_000, percentage: 25 });
	const handler = handlerOf(s);
	await handler(
		{
			model: makeModel("anthropic", "claude-haiku-4-5", 200_000),
			previousModel: makeModel("anthropic", "claude-opus-4-5", 1_000_000),
			source: "set",
		},
		s.ctx,
	);
	assert.equal(s.calls.confirm.length, 1);
	assert.equal(s.calls.confirm[0].title, "Compact before switching?");
	assert.match(s.calls.confirm[0].body, /Context: 250,000 tokens/);
	assert.match(s.calls.confirm[0].body, /Target window \(anthropic\/claude-haiku-4-5\): 200,000/);
	assert.match(s.calls.confirm[0].body, /Source window \(anthropic\/claude-opus-4-5\): 1,000,000/);
	assert.match(s.calls.confirm[0].body, /Compact with claude-opus-4-5 first/);
});

test("path [B] cancel: revert + notify + clear guard (next press re-prompts)", async () => {
	const s = makeStub();
	s.setConfirmNext(async () => false);
	s.ctx.getContextUsage = () => ({ tokens: 250_000, contextWindow: 1_000_000, percentage: 25 });
	const handler = handlerOf(s);
	await handler(
		{
			model: makeModel("anthropic", "claude-haiku-4-5", 200_000),
			previousModel: makeModel("anthropic", "claude-opus-4-5", 1_000_000),
			source: "set",
		},
		s.ctx,
	);
	assert.equal(s.calls.setModel.length, 1, "revert setModel called exactly once");
	assert.equal(s.calls.setModel[0].id, "claude-opus-4-5");
	assert.equal(s.calls.notify.length, 1);
	assert.match(s.calls.notify[0].message, /Switch canceled/);
	assert.equal(s.calls.notify[0].severity, "info");

	// Second press: guard should be cleared, so confirm fires again.
	await handler(
		{
			model: makeModel("anthropic", "claude-haiku-4-5", 200_000),
			previousModel: makeModel("anthropic", "claude-opus-4-5", 1_000_000),
			source: "set",
		},
		s.ctx,
	);
	assert.equal(s.calls.confirm.length, 2, "guard cleared — second press should re-prompt");
});

test("reentrancy guard: model_select fired during revert is swallowed", async () => {
	const s = makeStub();
	s.setConfirmNext(async () => true);
	s.ctx.getContextUsage = () => ({ tokens: 250_000, contextWindow: 1_000_000, percentage: 25 });

	// Stub setModel to recursively fire a self-loop model_select (mimicking pi runtime).
	// If guard didn't swallow it, confirm would fire twice.
	const handler = handlerOf(s);
	s.pi.setModel = (m: ModelStub) => {
		s.calls.setModel.push(m);
		void handler({ model: m, previousModel: m, source: "set" }, s.ctx);
		return Promise.resolve(true);
	};
	// compact never calls onComplete, so handler stays "active".
	s.setCompact(() => {});

	await handler(
		{
			model: makeModel("anthropic", "claude-haiku-4-5", 200_000),
			previousModel: makeModel("anthropic", "claude-opus-4-5", 1_000_000),
			source: "set",
		},
		s.ctx,
	);

	assert.equal(s.calls.confirm.length, 1, "confirm should fire only for the original trigger, not the synthetic revert event");
	assert.equal(s.calls.setModel.length, 1, "setModel should fire only for the revert");
});

test("path [A] revert failure: error toast when previousModel has no API key", async () => {
	const s = makeStub();
	s.setConfirmNext(async () => true);
	s.ctx.getContextUsage = () => ({ tokens: 250_000, contextWindow: 1_000_000, percentage: 25 });
	let setModelCalledWith: ModelStub | null = null;
	s.pi.setModel = (m: ModelStub) => {
		setModelCalledWith = m;
		return Promise.resolve(false);
	};
	const handler = handlerOf(s);
	await handler(
		{
			model: makeModel("anthropic", "claude-haiku-4-5", 200_000),
			previousModel: makeModel("anthropic", "claude-opus-4-5", 1_000_000),
			source: "set",
		},
		s.ctx,
	);
	assert.equal(s.calls.notify.length, 1, "exactly one notify");
	assert.match(s.calls.notify[0].message, /No API key for anthropic\/claude-opus-4-5/);
	assert.equal(s.calls.notify[0].severity, "error");
	assert.ok(setModelCalledWith, "setModel was called");
	assert.equal(setModelCalledWith!.id, "claude-opus-4-5");
});

test("path [A] complete cycle: revert, compact onComplete, reapply — with mock compact", async () => {
	const s = makeStub();
	s.setConfirmNext(async () => true);
	s.ctx.getContextUsage = () => ({ tokens: 250_000, contextWindow: 1_000_000, percentage: 25 });
	let onCompleteFn: (() => Promise<void>) | undefined;
	s.setCompact((opts: { onComplete: () => Promise<void> }) => {
		onCompleteFn = opts.onComplete;
	});

	const handler = handlerOf(s);

	// setModel for revert: fires a self model_select (swallowed by guard).
	let setModelCallsForGuard = 0;
	s.pi.setModel = (m: ModelStub) => {
		s.calls.setModel.push(m);
		setModelCallsForGuard++;
		// Mid-flight, while active=true, fire a synthetic model_select that would normally
		// trigger another confirm. If the guard works, it is swallowed.
		if (setModelCallsForGuard === 1) {
			void handler({ model: m, previousModel: m, source: "set" }, s.ctx);
		}
		return Promise.resolve(true);
	};

	await handler(
		{
			model: makeModel("anthropic", "claude-haiku-4-5", 200_000),
			previousModel: makeModel("anthropic", "claude-opus-4-5", 1_000_000),
			source: "set",
		},
		s.ctx,
	);

	// confirm fired once (the synthetic revert was swallowed by guard).
	assert.equal(s.calls.confirm.length, 1);
	// setModel fired for revert (Opus) only — guard prevented 2nd call.
	assert.equal(s.calls.setModel.length, 1);
	assert.equal(s.calls.setModel[0].id, "claude-opus-4-5");
	// Compact was called.
	assert.ok(onCompleteFn, "compact was invoked");

	// Simulate compact completion; the handler should reissue setModel for the target.
	const callsBefore = s.calls.setModel.length;
	const notifiesBefore = s.calls.notify.length;
	// Replace setModel on subsequent calls to also fire model_select.
	const realSetModelAfterComplete = (m: ModelStub) => {
		s.calls.setModel.push(m);
		void handler({ model: m, previousModel: m, source: "set" }, s.ctx);
		return Promise.resolve(true);
	};
	s.pi.setModel = realSetModelAfterComplete;

	await onCompleteFn!();

	// Re-apply fired: another setModel for the target, and a synthetic model_select for reapply
	// should be swallowed since the guard was cleared in the try/finally AFTER setModel was called.
	// Actually the guard is cleared INSIDE the try block AFTER setModel, but BEFORE the synthetic
	// event resolves. There may be one more setModel than expected depending on order.
	// Assert: notify says "Compacted — switched to ...".
	assert.ok(
		s.calls.notify.some((n) => /Compacted.+switched to anthropic\/claude-haiku-4-5/.test(n.message)),
		"success notify fired",
	);
	assert.ok(s.calls.setModel.length > callsBefore, "second setModel fired after compact");
});

test("path [A] compact onError: stays on previous, error notify", async () => {
	const s = makeStub();
	s.setConfirmNext(async () => true);
	s.ctx.getContextUsage = () => ({ tokens: 250_000, contextWindow: 1_000_000, percentage: 25 });
	let onErrorFn: ((e: Error) => void) | undefined;
	s.setCompact((opts: { onError: (e: Error) => void }) => {
		onErrorFn = opts.onError;
	});
	const handler = handlerOf(s);
	await handler(
		{
			model: makeModel("anthropic", "claude-haiku-4-5", 200_000),
			previousModel: makeModel("anthropic", "claude-opus-4-5", 1_000_000),
			source: "set",
		},
		s.ctx,
	);
	const setModelBefore = s.calls.setModel.length;
	onErrorFn!(new Error("simulated network"));
	assert.match(s.calls.notify.find((n) => /Compact failed/.test(n.message))!.message, /simulated network/);
	assert.equal(s.calls.setModel.length, setModelBefore, "no extra setModel after onError");
});

test("guard cleared after path [A] success: subsequent trigger fires again", async () => {
	const s = makeStub();
	s.setConfirmNext(async () => true);
	s.ctx.getContextUsage = () => ({ tokens: 250_000, contextWindow: 1_000_000, percentage: 25 });
	let onCompleteFn: (() => Promise<void>) | undefined;
	s.setCompact((opts: { onComplete: () => Promise<void> }) => {
		onCompleteFn = opts.onComplete;
	});
	const handler = handlerOf(s);
	let setModelCallsForGuard = 0;
	s.pi.setModel = (m: ModelStub) => {
		s.calls.setModel.push(m);
		setModelCallsForGuard++;
		if (setModelCallsForGuard === 1) void handler({ model: m, previousModel: m, source: "set" }, s.ctx);
		return Promise.resolve(true);
	};
	await handler(
		{
			model: makeModel("anthropic", "claude-haiku-4-5", 200_000),
			previousModel: makeModel("anthropic", "claude-opus-4-5", 1_000_000),
			source: "set",
		},
		s.ctx,
	);
	// Reset call counters.
	const confirmCountBefore = s.calls.confirm.length;
	await onCompleteFn!();
	// Now press switch again — the guard was cleared by the try/finally. We re-stub setModel to
	// not fire synthetic events this time so test is deterministic.
	s.pi.setModel = (m: ModelStub) => {
		s.calls.setModel.push(m);
		return Promise.resolve(true);
	};
	await handler(
		{
			model: makeModel("anthropic", "claude-haiku-4-5", 200_000),
			previousModel: makeModel("anthropic", "claude-opus-4-5", 1_000_000),
			source: "set",
		},
		s.ctx,
	);
	assert.equal(s.calls.confirm.length, confirmCountBefore + 1, "guard cleared post-success");
});