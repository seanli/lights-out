# board

The rules of the game. Owns the `board` slice: `{ status: 'empty'|'playing'|'solved', levelId, start, cells, par, moves, history, shape? }`.
`shape` is stored only for a non-classic board, so classic snapshots and payloads are exactly as before.

- `board:load {levelId, cells, par, shape?}` → `board:loaded` (with `shape` when not classic), or refused `bad_board`
  (shape fails `ShapeSchema`, cells don't fit it via `fitsShape` (wrong length, a lit gap), nothing lit, bad id/par).
- `board:press {index}` → toggles `pressTargets(shape, index)` (never across a gap), `board:pressed {…, litCount}`; the last
  light out also sets status `solved` and emits `board:solved` once. Refused `not_playing` / `bad_index` (a gap or off the grid) /
  `stuck` (a stuck cell: no move is spent). Shapes are checked with `shapeProblem` (a cube must be its net, wiring only on squares).
- `board:undo` → re-toggles the newest press, moves −1, `board:undone`. Refused `not_playing` / `nothing_to_undo`.
- `board:restart` → back to `start`, moves 0 (works after a solve), `board:restarted`. Refused `not_playing` before any load.
- The toggle maths is `src/lib/shape.ts`; the solver is optional and only used by the console.

Console: `board.show` (ASCII grid; gaps are spaces), `board.set <0/1 per grid position>` (on the current shape; loads it
under the current level or 1, par from the solver or 0), `board.win` (presses the solver's solution).

A press costs ~30µs through the kernel. No data. Delete it and nothing can be played; everything else still boots.
