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

## Automated tests

```bash
npm test                  # or ./scripts/test.sh
```

31 tests cover the trigger filter (cycle/restore/no-previous/same-model/widening/overflow) and the orchestrator paths (cancel, revert failure, reentrancy guard, compact onError, guard recovery).

Tests use Node 22+ built-in `node:test` with `--experimental-strip-types`. No transpile step.

## Behavior

- `/model` switch from larger window → smaller window, current context > target window − 16,384: confirm → revert → compact with outgoing model → re-apply target.
- Widening switches: silent.
- Same-model re-selects: silent.
- Cycle (`Ctrl+P`): silent.
- Cancel: revert to outgoing model, toast.
- Failure: stay on outgoing model, error toast.

See `docs/superpowers/specs/2026-06-15-compact-before-switch-design.md` for full design.
