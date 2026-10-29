# levels

Owns the `levels` slice: `{ status, list: LevelDef[], chapters, packs: Pack[], error? }`. Uses `solver` and `rng`.
Data: `rules.json → levels` (seed, bands, maxTries, chapters, readable, roomTries, fixFrom, looks, pictures, rooms), `copy.json → levels` (names).

- At init, makes the classic path from `rng.seeded(rules.seed)` (pinned by a hash test; levels 1–2, the tutorial's, never
  change), then each room from its own `rng.seeded(room.seed)`: kind size/stuck/wired (`cols/rows`), shape (`picture`),
  hex / cube (`side`); ids `idBase + 1..`. Per level: a hand-made board where `pictures` puts one (`"all"` = every light
  on; par is what it needs), else `lib/puzzle.ts makePuzzle`: a symmetric board (`looks`: a level takes `levels` in turn,
  a boss `boss`; stuck cells or wiring placed to match) or, where `levels` says "tangled", tangled presses with no symmetry. Par exact, no press readable whole, never a
  pinwheel; from level `fixFrom` (3) a board you chase never gives par away (`chaseClears`). Out of tries → the closest
  board + warning. ~200 ms for all 320 levels in the browser. Retired rooms' ids stay reserved.
- `list`: classic first (ids 1..50, at `list[id − 1]`, no pack fields), then room levels with `pack`, `index`, `shape`.
- `packs`: classic first, then rooms in data order, names from copy. Bad rooms or pictures (overlapping ids, no name, par
  above the cell count, a picture the wrong size, lighting a gap, unsolvable or in a stuck/wired room) stop the game with a plain message.
- `start()` emits `levels:generated {count, pars}` about the classic path only.
- `levels:start {levelId}` → `board:load {…, shape?}` + `levels:started {levelId, par, count, pack, index, next}`
  (count = levels in that pack, next = following id in the pack or null). Refused `not_ready`, `unknown`, or `locked`:
  classic above `progress.unlockedUpTo`; a room level unless `progress.varietyOpen` and `index ≤ progress.packs[room].unlockedUpTo`.
  No progress slice → everything open. Console: `levels.start <id>`, `levels.list` (id: par, with pack and index for rooms).
