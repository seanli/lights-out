# solver

Provides the `solver` service: pure functions over 5×5 boards. No slice, no events, no data.

- `press(cells, i)` → new board with `i` and its up/down/left/right neighbours toggled (no wrap).
- `solve(cells)` → fewest presses that clear the board, sorted ascending, or `null` if unsolvable.
- `isSolvable(cells)`.

How (`gf2.ts`): boards are 25-bit masks. At init, Gauss-Jordan on the press matrix (rank 23)
gives two parity checks (solvability), a linear map board → one solution (split into four
lookup tables) and the null space (4 vectors). A solve is 2 checks, 4 lookups and 4 popcounts
(~0.4 µs in Node). Every solvable board has exactly 4 solutions; we return the lightest.
Minimal solutions never exceed 15 presses.

Console: `solver.solve` solves the board that's showing.
Bad input (not 25 cells, index off the board) throws a plain message.
Tests cross-check against `test/ref-solver.ts` on 2000 random boards.
