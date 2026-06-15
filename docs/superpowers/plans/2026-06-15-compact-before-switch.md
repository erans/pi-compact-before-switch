# Compact Before Model Switch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pi extension that, when the user picks a smaller-context model via `/model` and the active context overflows that window, confirms with the user, reverts to the outgoing (larger-context) model, runs pi's default compaction, then re-applies the user's pick.

**Architecture:** Single TypeScript extension file, no dependencies beyond `@earendil-works/pi-coding-agent`. Subscribes to `model_select` event; checks trigger conditions; runs a confirm dialog; orchestrates revert → `ctx.compact()` → re-apply with a reentrancy guard (boolean + 30s safety timer).

**Tech Stack:** TypeScript (extension loaded via jiti at runtime), `pi -e` for manual testing, target pi ≥ current install. No compiler step.

**Spec:** `docs/superpowers/specs/2026-06-15-compact-before-switch-design.md`.

---

## File Structure

```
pi-compact-before-switch/
├── README.md                               # Install + usage + verification
├── extension/
│   └── compact-before-switch.ts            # Canonical extension source
└── docs/superpowers/
    ├── specs/2026-06-15-compact-before-switch-design.md
    └── plans/2026-06-15-compact-before-switch.md
```

The canonical source lives at `extension/compact-before-switch.ts`. Run it via `pi -e extension/compact-before-switch.ts` for testing. Copy to `~/.pi/agent/extensions/` only after manual verification passes (Task 10).

---

## Task 1: Scaffold project (README, smoke script)

**Files:**
- Create: `README.md`
- Create: `scripts/smoke.sh`

- [ ] **Step 1: Write README.md**

Create `/home/eran/work/pi-compact-before-switch/README.md`:

```markdown
# pi-compact-before-switch

A [pi](https://pi.dev) extension that prompts you to compact context using the
**outgoing** model before switching to a smaller-window model via `/model`.
Skips Ctrl+P cycling.

## Install

```bash
cp extension/compact-before-switch.ts ~/.pi/agent/extensions/
pi /reload
```

## Test locally without installing

```bash
./scripts/smoke.sh
```

Then exercise scenarios from `docs/superpowers/specs/2026-06-15-compact-before-switch-design.md` §Testing.

## Behavior

- `/model` switch from larger window → smaller window, current context > target window − 16,384: confirm → revert → compact with outgoing model → re-apply target.
- Widening switches: silent.
- Same-model re-selects: silent.
- Cycle (`Ctrl+P`): silent.
- Cancel: revert to outgoing model, toast.
- Failure: stay on outgoing model, error toast.

See `docs/superpowers/specs/2026-06-15-compact-before-switch-design.md` for full design.
```

- [ ] **Step 2: Write scripts/smoke.sh**

Create `/home/eran/work/pi-compact-before-switch/scripts/smoke.sh`:

```bash
#!/usr/bin/env bash
# Launch pi with the canonical extension loaded, fresh session.
# Args after `--` are forwarded to pi (e.g. `--model anthropic/claude-sonnet-4-5`).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
exec pi -e "$REPO_DIR/extension/compact-before-switch.ts" "$@"
```

- [ ] **Step 3: Make smoke.sh executable**

Run: `chmod +x /home/eran/work/pi-compact-before-switch/scripts/smoke.sh`
Expected: no output.

- [ ] **Step 4: Commit**

Run:
```bash
cd /home/eran/work/pi-compact-before-switch
git add README.md scripts/smoke.sh
git commit -m "chore: scaffold project (README, smoke script)"
```

---

## Task 2: Extension skeleton — imports + factory

**Files:**
- Create: `extension/compact-before-switch.ts`

- [ ] **Step 1: Write the file with imports and factory**

Create `/home/eran/work/pi-compact-before-switch/extension/compact-before-switch.ts`:

```typescript
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
```

- [ ] **Step 2: Sanity-check that pi can load it**

Run: `./scripts/smoke.sh --help`
Expected: pi starts, extension loads without TypeScript compile errors, and `--help` text appears. Exit with Ctrl+C afterwards.

If jiti throws a syntax error, fix the file. Otherwise pass.

- [ ] **Step 3: Commit**

Run:
```bash
cd /home/eran/work/pi-compact-before-switch
git add extension/compact-before-switch.ts
git commit -m "feat: extension skeleton with imports and factory"
```

---

## Task 3: Trigger conditions

**Files:**
- Modify: `extension/compact-before-switch.ts`

- [ ] **Step 1: Add module-level state declarations**

Replace the placeholder factory body with:

```typescript
export default function (pi: ExtensionAPI): void {
  // Reentrancy guard state.
  let active = false;
  let pendingTarget: Model<any> | null = null;
  let guardTimer: ReturnType<typeof setTimeout> | null = null;
}
```

- [ ] **Step 2: Add the trigger conditions inside the factory**

Replace the body again with:

```typescript
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
```

- [ ] **Step 3: Verify compile**

Run: `./scripts/smoke.sh --help` and Ctrl+C.
Expected: extension loads without TypeScript errors.

- [ ] **Step 4: Smoke test — narrowing with overflow should reach the unbuilt branch (silent for now)**

Manual:
1. Start: `./scripts/smoke.sh` (no args; default model is loaded).
2. In pi, hold a real session that has >200k tokens (use a long-running task or compact multiple times then uncompact).
3. Press `/model` and pick a model with `contextWindow` smaller than current. Click through to confirm selection.
4. Expected: model switches silently — handler exits without UI yet (Task 4 will add the dialog).
5. Exit with Ctrl+C.

If anything crashes, check that `ctx.getContextUsage()` returns the expected shape. It returns `ContextUsage | null` per `extensions.md` §ExtensionContext.

- [ ] **Step 5: Commit**

Run:
```bash
cd /home/eran/work/pi-compact-before-switch
git add extension/compact-before-switch.ts
git commit -m "feat: model_select handler with trigger conditions"
```

---

## Task 4: Confirm dialog with formatted body

**Files:**
- Modify: `extension/compact-before-switch.ts`

- [ ] **Step 1: Add dialog body formatter above the factory**

Insert just below the `import` line:

```typescript
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
```

- [ ] **Step 2: Wire `ctx.ui.confirm` into the handler**

Replace the trailing comment block in the handler (after `if (tokens <= model.contextWindow - RESERVE_TOKENS) return;`) with:

```typescript
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
```

(The closing `});` and `}` of the handler must remain.)

- [ ] **Step 3: Verify compile**

Run: `./scripts/smoke.sh --help` then Ctrl+C.
Expected: no TypeScript errors.

- [ ] **Step 4: Manual test dialog appearance**

Manual:
1. `./scripts/smoke.sh`.
2. Reach a state where overflow would trigger (per Task 3 step 4).
3. `/model` → pick smaller model → confirm in `/model` selector.
4. Expected: the confirm dialog appears with the formatted 4-line body. (Cancel closes dialog, no toast yet — that's Tasks 6/7.)

- [ ] **Step 5: Commit**

Run:
```bash
cd /home/eran/work/pi-compact-before-switch
git add extension/compact-before-switch.ts
git commit -m "feat: confirm dialog with formatted body"
```

---

## Task 5: Reentrancy guard helper

**Files:**
- Modify: `extension/compact-before-switch.ts`

- [ ] **Step 1: Add `setActive` helper above factory**

Insert just below `formatConfirmBody`:

```typescript
function setActive(
  state: { active: boolean; pendingTarget: Model<any> | null; guardTimer: ReturnType<typeof setTimeout> | null },
  value: boolean,
  onTimeout: () => void,
): void {
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
```

- [ ] **Step 2: Verify compile**

Run: `./scripts/smoke.sh --help` then Ctrl+C.
Expected: no errors. (The helper isn't called yet — Task 6 wires it up.)

- [ ] **Step 3: Commit**

Run:
```bash
cd /home/eran/work/pi-compact-before-switch
git add extension/compact-before-switch.ts
git commit -m "feat: setActive reentrancy guard helper"
```

---

## Task 6: Path [A] — confirm + revert + compact + re-apply

**Files:**
- Modify: `extension/compact-before-switch.ts`

- [ ] **Step 1: Refactor top-of-factory state to `stateRef` object**

Replace the existing top-of-factory declaration:

```typescript
  let active = false;
  let pendingTarget: Model<any> | null = null;
  let guardTimer: ReturnType<typeof setTimeout> | null = null;
```

with:

```typescript
  const stateRef = {
    active: false,
    pendingTarget: null as Model<any> | null,
    guardTimer: null as ReturnType<typeof setTimeout> | null,
  };
```

Update the handler's first-line guard from `if (active) return;` to `if (stateRef.active) return;`.

- [ ] **Step 2: Wire path [A] body**

Replace the comment `// Path [A]: confirm. Built in Task 6.` with:

```typescript
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
    }
```

- [ ] **Step 3: Verify compile**

Run: `./scripts/smoke.sh --help`, Ctrl+C.
Expected: no TypeScript errors. Path [B] still empty (Task 7).

- [ ] **Step 4: Manual end-to-end test — scenario 1**

Manual:
1. Note current model (Anthropic Opus 1M, max 1M tokens).
2. Reach a session >200k tokens (run several long turns).
3. `/model` → Anthropic Haiku 4.5 → confirm in selector.
4. Expected: confirm dialog appears (Task 4) → click Confirm.
5. Expected: model reverts to Opus briefly, compact starts (loading state in pi), then model switches to Haiku on completion. Two toasts: "Compacting with anthropic/claude-opus-… before switch…" then "Compacted — switched to anthropic/claude-haiku-…".
6. Final context: should be ~64k tokens (post-compaction).

If step 5 fails (no dialog, error toast about API key): check that ANTHROPIC_API_KEY is set or `/login` was used. The plugin surfaces the failure per spec.

- [ ] **Step 5: Commit**

Run:
```bash
cd /home/eran/work/pi-compact-before-switch
git add extension/compact-before-switch.ts
git commit -m "feat: path A — confirm + revert + compact + re-apply"
```

---

## Task 7: Path [B] — cancel + revert + notify

**Files:**
- Modify: `extension/compact-before-switch.ts`

- [ ] **Step 1: Wire path [B] body**

Replace the comment `// Path [B]: cancel. Built in Task 7.` with:

```typescript
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
```

- [ ] **Step 2: Verify compile**

Run: `./scripts/smoke.sh --help`, Ctrl+C.
Expected: no errors.

- [ ] **Step 3: Manual test — scenario 6 (cancel path)**

Manual:
1. State with overflow per Task 6 step 4.
2. `/model` → Haiku 4.5 → Confirm switch in selector.
3. Confirm dialog appears. Click Cancel.
4. Expected: model reverts to Opus, toast `"Switch canceled. Context still too large for anthropic/claude-haiku-4-5. Run /compact manually when ready."`
5. Now run `/model` → Haiku 4.5 again. Expected: confirm dialog appears again (no infinite swallow).
6. Exit with Ctrl+C.

- [ ] **Step 4: Commit**

Run:
```bash
cd /home/eran/work/pi-compact-before-switch
git add extension/compact-before-switch.ts
git commit -m "feat: path B — cancel + revert + notify"
```

---

## Task 8: Failure path — old-model auth missing

**Files:**
- Modify: `extension/compact-before-switch.ts`

- [ ] **Step 1: Verify path [A] already handles this**

The body inserted in Task 6 step 2 already contains:

```typescript
    const revertOk = await pi.setModel(previousModel);
    if (!revertOk) {
      ctx.ui.notify(
        `No API key for ${previousModel.provider}/${previousModel.id}. Switch canceled; staying on ${model.provider}/${model.id}.`,
        "error",
      );
      return;
    }
```

No code change required. Verify by reading the file.

Run: `grep -n 'No API key' /home/eran/work/pi-compact-before-switch/extension/compact-before-switch.ts`
Expected: 1 match inside path [A] block.

- [ ] **Step 2: Manual test — scenario 7 (auth missing)**

Manual:
1. Unsubscribe Anthropic: `unset ANTHROPIC_API_KEY` then `/login` to a different provider (e.g. OpenAI). Or use `/logout` and `/login` to switch.
2. Reach overflow state on the new provider's larger model.
3. `/model` → pick the smaller model from a *different* provider.
   - Note: this plugin fires when narrowing window regardless of provider. To simulate auth missing on previousModel, log out the previousModel's provider (`/logout`), then attempt the switch.
4. Expected: confirm dialog appears (we're switching back to the auth'd provider) → click Confirm. Revert fails. Toast `"No API key for <previousProvider>/<previousModel>. Switch canceled; staying on <target>."`
5. The plugin does not proceed. Model remains on the target; user must re-auth.

- [ ] **Step 3: Commit (no code change, just a doc-only commit)**

Run:
```bash
cd /home/eran/work/pi-compact-before-switch
git commit --allow-empty -m "docs: scenario 7 verified against existing path [A] revert failure branch"
```

---

## Task 9: Run remaining manual scenarios

- [ ] **Step 1: Scenario 2 — wide → narrow, fits**

Manual:
1. Start `./scripts/smoke.sh` with default model (e.g. Opus).
2. Run a small conversation (~80k tokens).
3. `/model` → Haiku 4.5.
4. Expected: model switches silently, no dialog. Verify `ctx.getContextUsage().tokens < 200,000 - 16,384` to confirm trigger condition 5 was a no-op.

- [ ] **Step 2: Scenario 3 — narrow → wide**

Manual:
1. Start `./scripts/smoke.sh --model anthropic/claude-haiku-4-5`.
2. Reach any token count.
3. `/model` → Opus.
4. Expected: model switches silently. Trigger condition 4 (`model.contextWindow >= previousModel.contextWindow`) returns early, no dialog.

- [ ] **Step 3: Scenario 4 — same-model re-select**

Manual:
1. Start `./scripts/smoke.sh` with Opus.
2. `/model` → Opus (re-select the same model).
3. Expected: silent. Trigger condition 3 (`model.id === previousModel.id && model.provider === previousModel.provider`) returns early.

- [ ] **Step 4: Scenario 5 — Ctrl+P cycling is silent**

Manual:
1. Reach overflow state.
2. Save models to scoped list: `/scoped-models` → mark Opus and Haiku both.
3. Press `Ctrl+P` repeatedly to cycle.
4. Expected: no confirm dialog at any step. (Spec §Trigger Conditions #1: cycles are excluded.)

- [ ] **Step 5: Scenario 8 — compact failure mid-flight**

Manual:
1. Reach overflow state on Opus.
2. Disconnect network: `sudo iptables -A OUTPUT -p tcp --dport 443 -j DROP` (Linux), `pfctl -d` (macOS), or kill backend network process.
3. `/model` → Haiku 4.5 → Confirm.
4. Expected: confirm dialog → Confirm. Revert to Opus succeeds. Compact fails (network). Toast `"Compact failed: <reason>. Staying on anthropic/claude-opus-…."`.
5. Restore network. Run `/model` → Haiku 4.5 again. Confirm. Expected: confirm dialog appears; the previous state was correctly cleared.
6. Restore state: `sudo iptables -D OUTPUT -p tcp --dport 443 -j DROP` (or `pfctl -e`).

- [ ] **Step 6: Scenario 9 — 30s timeout**

Manual:
1. Reach overflow state on Opus.
2. Pause compaction artificially: kill any LLM-related processes that the plugin relies on. (Hard to simulate without code modifications — alternative: comment out the `onComplete` callback in a test build, run, and verify the timeout fires after 30s.)
3. As a fallback, simply leave the network offline for >30s and observe the safety toast firing even before pi's own compaction error path.
4. Expected: after 30s, toast `"Compact before switch timed out — pick a model again when ready."`. Re-running `/model` should now work normally (state cleared).

- [ ] **Step 7: Commit verification log**

Run: `mkdir -p /home/eran/work/pi-compact-before-switch/verification && cat > /home/eran/work/pi-compact-before-switch/verification/manual-test-log.md << 'EOF'
# Manual test log

Date: 2026-06-15

| # | Scenario | Pass? | Notes |
|---|----------|-------|-------|
| 1 | Wide → narrow, overflow | TBD | Task 6 step 4 |
| 2 | Wide → narrow, fits | TBD | Task 9 step 1 |
| 3 | Narrow → wide | TBD | Task 9 step 2 |
| 4 | Same-model re-select | TBD | Task 9 step 3 |
| 5 | Ctrl+P cycling silent | TBD | Task 9 step 4 |
| 6 | User cancels | TBD | Task 7 step 3 |
| 7 | Old-model auth missing | TBD | Task 8 step 2 |
| 8 | Compact mid-flight failure | TBD | Task 9 step 5 |
| 9 | 30s timeout | TBD | Task 9 step 6 |
EOF
git add verification/manual-test-log.md
git commit -m "docs: manual test log scaffold (filled during Task 9 execution)"`

---

## Task 10: Install to ~/.pi/agent/extensions/ and final verification

**Files:**
- Copy: `extension/compact-before-switch.ts` → `~/.pi/agent/extensions/compact-before-switch.ts`
- Modify: `verification/manual-test-log.md` (mark all scenarios pass)

- [ ] **Step 1: Copy the extension to the user's pi extensions directory**

Run:
```bash
cp /home/eran/work/pi-compact-before-switch/extension/compact-before-switch.ts ~/.pi/agent/extensions/compact-before-switch.ts
ls -la ~/.pi/agent/extensions/compact-before-switch.ts
```

Expected: file exists and matches the canonical source.

- [ ] **Step 2: Smoke-test the installed copy**

Run: `pi /reload && pi -e ~/.pi/agent/extensions/compact-before-switch.ts` then Ctrl+C.
Expected: pi loads extension from `~/.pi/agent/extensions/` (note: when no `-e` is passed, auto-discovery applies; using `-e` to the same path is harmless).

Alternatively, run plain `pi` (auto-discovery) and verify behavior with scenarios 1 and 6 again.

- [ ] **Step 3: Mark manual-test-log entries pass**

Update `verification/manual-test-log.md` rows from `TBD` to `Pass` or `Fail` based on actual results.

- [ ] **Step 4: Commit verification updates**

Run:
```bash
cd /home/eran/work/pi-compact-before-switch
git add verification/manual-test-log.md
git commit -m "docs: mark manual test log entries per installation verification"
```

- [ ] **Step 5: Tag release v0.1.0**

Run:
```bash
cd /home/eran/work/pi-compact-before-switch
git tag -a v0.1.0 -m "Initial release: compact-before-switch for pi"
git log --oneline
```

---

## Self-Review Notes

- Spec coverage: every section in the spec maps to a task. Trigger conditions → Task 3. Confirm flow → Task 4. State machine A → Task 6, B → Task 7, C → Task 4 (silently for now; could be revisited). Reentrancy guard → Tasks 5-6. Failure paths → Tasks 6, 8. 30s timeout → Tasks 5, 9 step 6.
- Type consistency: `stateRef.active`, `stateRef.pendingTarget`, `stateRef.guardTimer` are referenced by both `setActive` helper and handler. `setActive` signature uses an inline structural type matching `stateRef`. `Model<any>` is used consistently.
- Placeholders: all code blocks contain full, runnable content. No "TBD" or "implement later".
- Manual test scenarios from spec §Testing all have a corresponding step (scenarios 1 through 9 are mapped to tasks 6 step 4, 9 step 1, 9 step 2, 9 step 3, 9 step 4, 7 step 3, 8 step 2, 9 step 5, 9 step 6).
