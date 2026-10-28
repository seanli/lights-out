# levels

Owns the `levels` slice: `{ status, list: LevelDef[], chapters, packs: Pack[], error? }`. Uses `solver` and `rng`.
Data: `rules.json → levels` (seed, bands, maxTries, chapters, readable, roomTries, rooms), `copy.json → levels` (names).

- At init, makes the classic path from `rng.seeded(rules.seed)` exactly as before rooms existed (pinned by a hash test:
  the 50 boards never change), then each room from its own `rng.seeded(room.seed)`: kind size/stuck/wired (`cols/rows`),
  shape (`picture`), hex (`side`: `hexagonShape`), cube (`side`: `cubeShape`); ids `idBase + 1..`. Per level: its own stuck
  cells or wiring (bands say how many), then `lib/puzzle.ts tangle`: clustered presses, par exact, no press readable as a
  whole footprint (`readable`). Out of tries → the closest board + warning. Retired rooms' ids stay reserved.
- `list`: classic first (ids 1..50, at `list[id − 1]`, no pack fields), then room levels with `pack`, `index`, `shape`.
- `packs`: classic first, then rooms in data order, names from copy. Bad rooms (overlapping ids, no name, par above the
  cell count, bad picture, fields for another kind) stop the game with a plain message. ~150 ms for all 320 levels in Node.
- `start()` emits `levels:generated {count, pars}` about the classic path only.
- `levels:start {levelId}` → `board:load {…, shape?}` + `levels:started {levelId, par, count, pack, index, next}`
  (count = levels in that pack, next = following id in the pack or null). Refused `not_ready`, `unknown`, or `locked`:
  classic above `progress.unlockedUpTo`; a room level unless `progress.varietyOpen` and `index ≤ progress.packs[room].unlockedUpTo`.
  No progress slice → everything open.
- Console: `levels.start <id>`, `levels.list` (id: par, with pack and index for rooms).
