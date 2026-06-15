# Manual test log

Tracks outcomes of running spec §Testing scenarios against the implementation.
Filled out as scenarios complete; rows updated from `TBD` → `Pass` / `Fail` / `Blocked`.

Date started: 2026-06-15

| # | Scenario | Plan task | Setup | Expected | Result | Notes |
|---|----------|-----------|-------|----------|--------|-------|
| 1 | Wide → narrow, with overflow | 6 step 4 | Opus 1M session, >200k tokens. `/model` → Haiku 200k | Confirm dialog → revert to Opus → compact → re-apply Haiku | TBD | |
| 2 | Wide → narrow, fits | 9 step 1 | Opus 1M session, ~80k tokens. `/model` → Haiku 200k | Silent switch (no dialog) | TBD | |
| 3 | Narrow → wide | 9 step 2 | Haiku 200k, any tokens. `/model` → Opus 1M | Silent switch (no dialog) | TBD | |
| 4 | Same-model re-select | 9 step 3 | Opus loaded. `/model` → Opus | Silent (trigger condition 3) | TBD | |
| 5 | Ctrl+P cycling silent | 9 step 4 | Overflow state. `/scoped-models` marks Opus + Haiku. `Ctrl+P` repeatedly | No dialog at any step | TBD | |
| 6 | User cancels | 7 step 3 | Overflow state. `/model` → Haiku, dialog appears, click Cancel | Revert to Opus, info toast. Re-running `/model` shows dialog again (no swallow). | TBD | |
| 7 | Old-model auth missing | 8 step 2 | Log out Opus's provider. Overflow state on a non-Opus model. `/model` → smaller model | Confirm → revert fails → error toast "No API key…" → state on target | TBD | |
| 8 | Compact mid-flight failure | 9 step 5 | Overflow state. Disconnect network. `/model` → Haiku, Confirm | Compact fails → error toast "Compact failed: <reason>." → state on Opus | TBD | |
| 9 | 30s timeout | 9 step 6 | Force compact to hang past 30s (artificial: kill outbound traffic or skip-onComplete temporarily) | Warning toast after 30s. `/model` works again immediately after. | TBD | |

Run command: `./scripts/smoke.sh` from repo root (loads extension via `-e`, no install needed).

To mark a row: change `TBD` to `Pass`, `Fail`, or `Blocked: <reason>`. Add notable behavior to the Notes column.
