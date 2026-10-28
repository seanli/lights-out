# board

The rules of the game. Owns the `board` slice: `{ status: 'empty'|'playing'|'solved', levelId, start, cells, par, moves, history }`.

- `board:load {levelId, cells, par}` → `board:loaded`, or refused `bad_board` (not 25 booleans, nothing lit, bad id/par).
- `board:press {index}` → toggles the cell and its up/down/left/right neighbours (no wrap), `board:pressed {…, litCount}`; the last light out also sets status `solved` and emits `board:solved` once. Refused `not_playing` / `bad_index`.
- `board:undo` → re-toggles the newest press, moves −1, `board:undone`. Refused `not_playing` / `nothing_to_undo`.
- `board:restart` → back to `start`, moves 0 (works after a solve), `board:restarted`. Refused `not_playing` before any load.
- The toggle maths lives here; the solver is optional and only used by the console.

Console: `board.show` (ASCII grid), `board.set 1100010000000000000000000` (loads it under the current level or 1, par from the solver or 0), `board.win` (presses the solver's solution).

A press costs ~30µs through the kernel (copies cells and history; history copy grows with moves).
No data. Delete it and nothing can be played; everything else still boots.
