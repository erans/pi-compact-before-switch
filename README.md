# pi-compact-before-switch

A [pi](https://pi.dev) extension that prompts you to compact context using the **outgoing** model before switching to a smaller-window model via `/model`. Ctrl+P cycling and session restore pass through silently.

When you switch from an Opus-1M to a Haiku-200K with a long conversation, you'll see:

![Confirm dialog](https://raw.githubusercontent.com/erans/pi-compact-before-switch/v0.1.0/examples/confirm-dialog.jpeg)

The dialog explains the source and target windows, current token count vs. the target minus reserve, and proceeds automatically if you confirm: revert to Opus, compact, re-apply Haiku. If you cancel, the switch is reverted.

## Install

```bash
pi install npm:pi-compact-before-switch
```

That's it. The extension registers automatically on next session start.

### Other install paths

```bash
pi install /path/to/pi-compact-before-switch    # local path
pi install https://example.com/pi-compact-before-switch.tgz   # URL
pi install -l .                                  # project-local (commits .pi/npm/ path)
```

## When does it trigger?

Conditions **all** met:

1. Source is `/model` (i.e. `source === "set"`, **not** Ctrl+P cycling and **not** session restore)
2. There was a previous model
3. Not re-selecting the same `(provider, id)`
4. New model's `contextWindow` < previous model's `contextWindow` (any narrowing)
5. `currentTokens > targetContextWindow − 16,384` (target fits, current doesn't)

If any condition is false, the switch is silent and immediate.

## Behavior

| Scenario | Result |
|---|---|
| `/model` from large → small, doesn't fit | confirm → revert → compact on outgoing model → re-apply target |
| `/model` from large → small, fits within reserve | silent, switch happens immediately |
| Widening (`small → big`) | silent |
| Same model re-selected | silent |
| `Ctrl+P` cycling | silent |
| Session restore | silent |
| Old model has no API key (revert fails) | stay on target, error toast |
| Compact mid-flight fails | stay on outgoing model, error toast |
| Confirm canceled | revert to outgoing model, info toast |
| 30 s timer elapses | warning toast, guard cleared, next press re-prompts |

## Minimal configuration

There is none. Run-time differences:

- **Reserve tokens** — 16,384 hardcoded. At or below threshold: switch is silent.
- **Guard timeout** — 30 s after a successful revert, the extension stops swallowing model_select events. If a compact hangs, the next press of `/model` works again after that.

## Why?

When you `Ctrl+P` through models you can land on one whose window is far below your current context. Many providers truncate silently. Compaction first avoids that.

## Development

```bash
git clone https://github.com/erans/pi-compact-before-switch
cd pi-compact-before-switch
npm test
./scripts/smoke.sh   # launches `pi -e extensions/compact-before-switch.ts`
```

Run tests:

```bash
./scripts/test.sh  # or: npm test
```

31 tests cover the trigger filter (cycle/restore/no-previous/same-model/widening/overflow) and the orchestrator paths (cancel, revert failure, reentrancy guard, compact onError, guard recovery). Tests use Node 22+ built-in `node:test` with `--experimental-strip-types`. No transpile step.

### Debug mode

Set `PI_DEBUG_CBS=1` to make the extension emit a notification on every `model_select` event with the event shape and the trigger decision:

```bash
PI_DEBUG_CBS=1 pi
```

The toast will say:

```
CBS DEBUG | source=set | prev=anthropic/claude-opus-4-5 (1000000) | next=anthropic/claude-haiku-4-5 (200000) | tokens=12345 | threshold (next - 16384)=183616 | trigger=true
```

## License

MIT © 2026 Eran Sandler. See [LICENSE](./LICENSE).

## Source layout

```
pi-compact-before-switch/
├── extensions/
│   └── compact-before-switch.ts    # the single extension file
├── tests/                          # node:test, 31 tests
├── scripts/
│   ├── smoke.sh                    # launch pi -e ...
│   └── test.sh                     # npm test runner
├── verification/                   # per-scenario outcomes
├── docs/                           # spec + design + plan
├── package.json
├── README.md
└── LICENSE
```

When published, pi's convention auto-discovers `extensions/*.ts` and loads it as a single extension — no `pi` manifest needed.
