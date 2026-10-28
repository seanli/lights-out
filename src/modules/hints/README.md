# hints

Owns the `hints` slice: `{ status: 'idle'|'showing', levelId, cell }`. Needs the `solver` service (skipped without it; the play view hides the button when the slice is absent).

- `hints:request` → asks `solver.solve(board.cells, board.shape)` (any room shape) and shows one cell of that fewest-presses solution: `hints:shown {levelId, index}`.
  Refused: `not_playing` (board not playing), `already_showing`, `unsolvable` (solver returned null).
- Which cell: `rules.json → hints.choice` = `"random"` (seeded `rng`, replayable) or `"first"` (lowest index).
- A showing hint clears on the next board change, emitting `hints:cleared {reason}`: press → `pressed`, undo → `undone`,
  restart → `restarted`, load → `level_changed`, and the winning press / `board:solved` → `solved`. Nothing is emitted if no hint was showing.
- `flags.json → hints.enabled: false` → writes no slice and registers no handlers.

The star cost is not here: progress counts `hints:shown`.
