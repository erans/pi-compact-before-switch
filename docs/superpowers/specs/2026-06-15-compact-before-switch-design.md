# Compact Before Model Switch — Design Spec

**Date:** 2026-06-15
**Project:** pi-compact-before-switch
**Status:** Draft (awaiting user review)

## Problem

Users of the pi coding agent frequently switch between models whose context windows differ. When switching from a larger-context model (e.g. Claude Opus 1M) to a smaller one (e.g. Claude Haiku 200k) the active conversation may already exceed the target's window. pi handles overflow reactively via auto-compaction against the *new* model, but the new model may be ill-suited to the summary task, and references to large tool results / artifacts may already be in flight when the swap happens.

The plugin offers to compact using the **old** (still larger-window) model before completing the switch, preserving conversation quality across the transition.

## Goals & Non-Goals

**Goals**
- Detect an imminent downgrade in context window at model-switch time.
- Confirm with the user, then compress with the outgoing model, then apply the new selection.
- Surface failures loudly (auth, rate limits, etc.) rather than degrading silently.

**Non-Goals**
- Cycling via Ctrl+P. (`source !== "cycle"` always — see §Trigger Conditions.)
- Session restoration at startup.
- Any user-facing runtime toggles, settings files, or commands.
- Custom compaction prompts; pi's default summarization is used.
- Substituting compaction models or queueing multiple compactions.

## Architecture

Single TypeScript extension file at `~/.pi/agent/extensions/compact-before-switch.ts`, no dependencies beyond `@earendil-works/pi-coding-agent`.

Components:

- **Trigger filter** (§Trigger Conditions). Pure logic on `(event, ctx) → boolean`.
- **Confirm dialog** (§Confirm Flow). Single `ctx.ui.confirm` call with formatted body.
- **State machine** (§State Machine). Three branches: confirm, cancel, ui-unavailable.
- **Orchestrator** (§Orchestration). Revert → compact → re-apply, with reentrancy guard.
- **Failure handler** (§Failure Paths). Error/timeout cleanup, surface to user via notify.

## Trigger Conditions

The plugin activates on `model_select` events matching **all** of:

| # | Condition | Reason |
|---|-----------|--------|
| 1 | `event.source === "set"` | `/model` picker only. Ctrl+P cycling is intentionally untouched. |
| 2 | `event.previousModel !== undefined` | No "previous" on first selection. |
| 3 | `event.model.id !== event.previousModel.id` | Defensive against same-model re-selects. |
| 4 | `event.model.contextWindow < event.previousModel.contextWindow` | Only intervene when narrowing the window. Widening never overflows. |
| 5 | `currentTokens > event.model.contextWindow - RESERVE_TOKENS` | Reserve defaults to 16384 tokens, mirroring pi's default `compaction.reserveTokens`. |

Where `currentTokens` comes from `ctx.getContextUsage()?.tokens` (treat `null`/`undefined` as 0, never trigger).

`RESERVE_TOKENS` is a file-level constant in v1 (16384). Reading the actual setting is out of scope.

Skipped triggers (`restore`, same-model, widening): pass through silently. No notify, no state mutation.

## Confirm Flow

When triggered, do **not** block the `model_select` handler — the user's selection has already mutated state. Instead, present a single confirmation:

```ts
await ctx.ui.confirm("Compact before switching?", dialogBody);
```

`dialogBody` text (multi-line):

```
Context: 142,300 tokens
Target window (claude-haiku-4-5): 200,000
Source window (claude-opus-4-5): 1,000,000

Compact with claude-opus-4-5 first, then switch.
```

`ctx.mode !== "tui"` paths (RPC, print): `ctx.hasUI` is `true` for RPC and false for print; gate the `confirm()` call on `ctx.hasUI` and fall through to path [C] when false.

## State Machine

Three outcomes branching on the dialog result.

### [A] User confirms

1. Set `active = true`, capture `pendingTarget = event.model`.
2. `await pi.setModel(event.previousModel)`. (Revert to outgoing model.)
3. `ctx.compact({ onComplete, onError })`. (Runs against the outgoing model now active.)
4. On `onComplete`: clear state, `await pi.setModel(pendingTarget)`, notify success.
5. On `onError`: clear state, notify failure, stay on previousModel.

### [B] User cancels

1. Set `active = true`, capture `pendingTarget = event.model`.
2. `await pi.setModel(event.previousModel)`.
3. Clear state (`active = false`, `pendingTarget = null`) — via try/finally so a `setModel` failure still resets.
4. Notify: `"Switch canceled. Context still too large for <target>. Run /compact manually when ready."`

### [C] UI unavailable or dialog error

1. Leave `event.model` active.
2. Notify warning: `"Auto-compact before switch unavailable; manual /compact may be required."`

## Orchestration

### Reentrancy guard

`pi.setModel()` synchronously fires `model_select`. Without a guard, our revert and re-apply calls would re-enter the handler and either loop or fire spurious prompts.

**Module-level state:**

```ts
let active = false;            // true while we're mid-flight (revert → compact → re-apply)
let pendingTarget: Model<any> | null = null;  // target model to re-apply after compact
let guardTimer: NodeJS.Timeout | null = null;

function setActive(value: boolean): void {
  active = value;
  if (guardTimer) clearTimeout(guardTimer);
  if (value) {
    guardTimer = setTimeout(() => {
      // Safety net: if neither onComplete nor onError fires within 30s,
      // clear state and notify.
      active = false;
      pendingTarget = null;
      ctx.ui.notify("Compact before switch timed out — pick a model again when ready.", "warning");
    }, 30_000);
  } else if (guardTimer) {
    guardTimer = null;
  }
}
```

(Timer uses the wider `setTimeout` export; ctx not captured at module-init time.)

**Handler first line:** `if (active) return;` — swallows events triggered by our own `setModel` calls.

### State transitions

| Event | active | pendingTarget | Action |
|-------|--------|---------------|--------|
| Trigger fires, about to revert | false | null | Set active=true, set pendingTarget=event.model |
| Our revert `setModel` fires | true | event.model | Swallowed (return early) |
| `compact.onComplete` | true | event.model | Clear state, `setModel(pendingTarget)` |
| Our re-apply `setModel` fires | true | null | Swallowed (return early) |
| `compact.onError` | true | null | Clear state, notify failure, stay on previousModel |

Both callbacks wrap their body in `try { … } finally { setActive(false); pendingTarget = null; }`.

### Compaction call shape

```ts
ctx.compact({
  // No customInstructions — use pi's default summarization prompt (Q5 outcome).
  onComplete: ...,
  onError: ...,
});
```

## Failure Paths

| Failure point | Recovery |
|---------------|----------|
| `compact.onError` fires | Stay on previousModel. Notify error msg. Clear state. (User must fix auth / try again.) |
| `pi.setModel(previousModel)` returns `false` (no API key) | Stay on `event.model` (target), since revert is impossible. Notify `"No API key for <oldModel>. Switch canceled; staying on <target>."`. Clear state. |
| `pi.setModel(target)` after completion returns `false` | Notify `"Switched to <target> failed; staying on <oldModel>"`. Clear state. |
| Compact process killed / hangs | 30-second safety timer clears `active` and notifies. |
| `ctx.compact`'s AbortSignal aborts | Honor via `try/finally` in the wrapped callbacks; clear state. |
| `getContextUsage().tokens` is null/undefined | Treat as 0, never trigger. |

## UI Feedback

| Phase | UI |
|-------|----|
| Compact starts | Single toast: `"Compacting with <oldModel> before switch…"`, severity `"info"`. |
| Compact succeeds, target re-applied | Single toast: `"Compacted — switched to <target>"`, severity `"info"`. |
| Confirm dialog canceled | Single toast described in §State Machine [B], severity `"info"`. |
| Any failure | Single toast per row in §Failure Paths, severity `"error"` or `"warning"` as appropriate. |
| 30s timeout | Toast `"Compact before switch timed out — pick a model again when ready."`, severity `"warning"`. |

No persistent status bar, no widget, no command. Toasts only.

## Code Structure

```
~/.pi/agent/extensions/compact-before-switch.ts
  └─ default export factory(pi: ExtensionAPI)
       ├─ module-level state: active, pendingTarget, RESERVE_TOKENS
       ├─ pi.on("model_select", handler)
       │    └─ trigger check → confirm → orchestrator
       └─ (no commands, no tools, no providers)
```

## Testing

Manual integration tests (no unit-test framework at project scale):

1. **Wide → narrow, overflow.** Switch from Opus 1M to Haiku 200k with a session above 200k tokens. Expect: confirm, revert to Opus, compact, re-apply Haiku, success toast. Final context tokens < 200k.
2. **Wide → narrow, fits.** Same model pair, conversation ~80k tokens. Expect: model switch completes silently without prompt.
3. **Narrow → wide.** Haiku → Opus. Expect: no prompt.
4. **Same model re-select.** Same model picked via `/model`. Expect: no prompt (handled by condition 3).
5. **Ctrl+P cycling.** Cycle through scoped models triggering `source: "cycle"`. Expect: never prompted.
6. **User cancels confirm.** Switch canceled path. Expect: revert to previousModel, info toast, no compaction API call beyond maybe a no-op.
7. **Old-model auth missing.** Remove API key for source model, attempt narrow switch starting in TUI mode. Expect path is: trigger fires → confirm → user confirms → revert via `pi.setModel(previousModel)` returns `false` → notify `"No API key for <oldModel>. Switch canceled; staying on <target>."` → state cleared. The plugin honors the table in §Failure Paths; the spec commits to "stay on target, surface error" rather than "refuse to revert." (Pre-switch we don't pre-check; the user-facing experience is the failure toast.)
8. **Compact failure mid-flight.** Force compact failure (e.g. simulate quota error). Expect: error toast, stay on previousModel, state cleared.
9. **30s timeout.** Force compact to hang past 30s. Expect: warning toast, active flag cleared, follow-up `/model` switch works normally.

## Out of Scope

- Custom compaction summarization.
- Setting overrides (`reserveTokens`, custom thresholds).
- `/cbs on/off` runtime command.
- Opus/1M context as primary target — works regardless of model pairing.
- Restoring sessions where the saved model is already too small for the saved context.
