# levels

Owns the `levels` slice: `{ status: 'ready' | 'error', list: [{id, cells, par}], chapters: [{id, name, from, to}], error? }`.
Uses `solver` and `rng`. Data: `rules.json → levels` (seed, pars, maxTries, chapters), `copy.json → levels.chapters` (names).

- At init, makes one level per entry of `pars` from `rng.seeded(rules.seed)` (never the session rng), so every
  player gets the same 50 boards. For par k: press k distinct random cells and keep the board when the solver's
  fewest presses is exactly k and no earlier level has that board. Out of tries → keeps the highest par found and
  logs a warning. About 15 ms in Node; the debug view shows the time and tries per level.
- Chapters must cover 1..pars.length once each, in order, and each needs a name; otherwise init throws naming the gap.
  Pars above 15 are rejected by the data schema (no 5×5 board needs more).
- `start()` emits `levels:generated {count, pars}`. If generation fails, the slice is `status: 'error'` with a plain `error`.
- `levels:start {levelId}` → `board:load {levelId, cells, par}` + `levels:started {levelId, par, count}`, or
  `levels:refused` with `not_ready`, `unknown` (not 1..count) or `locked` (above `progress.unlockedUpTo`; no
  progress slice means everything is open).
- Console: `levels.start <n>`, `levels.list` (id: par).

Generation and the chapter check live in `generate.ts` (pure).
