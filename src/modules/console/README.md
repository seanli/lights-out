# console

The in-game debug console. Only with `#debug` in the URL (`env.debug`) and `flags.json → console.enabled`; otherwise `init` returns before touching the DOM or subscribing to anything.

- Renders `[data-console]` into `view.region('overlay:console')`: a slim bar (starts collapsed; tap it to open) over a drawer of collapsible sections. Collapsed/open sections and command history live in `sessionStorage` (try/catch).
- **State** board kv + rows × cols 0/1 grid (gaps blank), one line per slice (tap for JSON) · **Events** last `eventLimit`, newest first; runs and short repeating cycles (press → pressed) collapse to one row `×N`; commands warm, facts teal, inputs marked `›`; tap a row for the payload · **Log** warn/error tinted, counts in the header · **Modules** chips (tap for status, reason, owns/uses) · **Services** `ctx.report()` results · **Snapshots** up to `snapshotLimit` in memory, Restore → `debug.restore`.
- Command line `[data-console-input]` (↑/↓ history): `help`, `state [slice]`, `emit <type> {json}`, `snap`, `restore <n>`, `clear` (events view only), and every `debug.commands()` entry as `module.command args…`. Results inline; errors in words; the events a command caused are listed after it.
- Renders on `debug.onChange`, at most once per animation frame, only open sections, and skips a section whose inputs didn't change.
- Phones: while collapsed the `.app` gets bottom padding so the bar never covers controls. ≥1180px wide: docked to the right of the game column.
- Data: `rules.console {eventLimit, logLimit, snapshotLimit}`, `copy.console`, `flags.console.enabled`. Emits and listens to nothing; owns no slice.
