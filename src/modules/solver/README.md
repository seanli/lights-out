# solver

Provides the `solver` service: pure functions over boards of any shape (cols × rows ≤ 7, optional gap mask). No slice, no events, no data. `shape` absent = classic 5×5.

- `press(cells, i, shape?)` → new board with `i` and its up/down/left/right real neighbours toggled (no wrap, never across a gap).
- `solve(cells, shape?)` → fewest presses that clear the board, sorted ascending (never a gap), or `null` if unsolvable or a gap is lit.
- `isSolvable(cells, shape?)`.

Classic (`gf2.ts`): 25-bit masks, rank 23, 4 solutions per board, chunked lookup tables: ~0.5 µs per solve.
Other shapes (`shaped.ts`): variables are the real cells only, held in two 32-bit words. Gauss-Jordan once per
`shapeKey`, cached (and per frozen shape object). A solve builds the board and its particular solution in one pass,
checks parity, then takes the lightest of solution XOR every null-space vector (searched fully up to dimension 12;
above that a greedy basis descent, logged as a warning). Null-space dimension: 4×4 4, 6×6 0, 7×7 0, Cross 2, Ring 2,
Diamond 0. About 0.6–2.6 µs per solve.

Console: `solver.solve` solves the board that's showing (with its shape). Bad input throws a plain message.
Tests: `solver.test.ts` (classic vs `test/ref-solver.ts`), `shapes.test.ts` (every room vs a BigInt reference, 4×4 vs brute force).
