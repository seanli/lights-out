# solver

Provides the `solver` service: pure functions over boards of any shape and grid (square with gaps, honeycomb, cube net,
per-cell wiring, stuck cells; up to 12 × 16). No slice, no events, no data. `shape` absent = classic 5×5.

- `press(cells, i, shape?)` → new board with what a press at `i` reaches toggled (`lib/shape.ts pressTargets`; a stuck cell: nothing).
- `solve(cells, shape?)` → fewest presses that clear the board, sorted ascending (never a gap), or `null` if unsolvable or a gap is lit.
- `isSolvable(cells, shape?)`.

Classic (`gf2.ts`): 25-bit masks, rank 23, 4 solutions per board, chunked lookup tables: ~0.5 µs per solve.
Other shapes (`shaped.ts`): one equation per real cell, one variable per pressable cell (the press map may be one-way:
wiring), held in 32-bit words. Gauss-Jordan once per
`shapeKey`, cached (and per frozen shape object). A solve builds the board and its particular solution in one pass,
checks parity, then takes the lightest of solution XOR every null-space vector (searched fully up to dimension 12;
above that a greedy basis descent, logged as a warning). Null-space dimension: 7×7 0, Ring 2, Diamond 0, 8×8 0, 8×16 0,
hexagon 4 → 4, cube 3 → 6, cube 4 → 0 (Custom: 20 × 30 → 0 in 40 ms, 19 × 19 → 16). About 0.6–3 µs per solve.

Console: `solver.solve` solves the board that's showing (with its shape). Bad input throws a plain message.
Tests: `solver.test.ts` (classic vs `test/ref-solver.ts`), `shapes.test.ts` (every room vs a BigInt reference), `grids.test.ts`
(wired, stuck and honeycomb boards vs brute force; cubes and hexagons against the presses that made them).
