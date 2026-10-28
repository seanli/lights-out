# levels

Owns the `levels` slice: `{ status, list: LevelDef[], chapters, packs: Pack[], error? }`. Uses `solver` and `rng`.
Data: `rules.json → levels` (seed, pars, maxTries, chapters, rooms), `copy.json → levels` (classic, chapters, rooms names).

- At init, makes the classic path from `rng.seeded(rules.seed)` exactly as before rooms existed (pinned by a hash test:
  the 50 boards never change), then each room in `rooms` from its own `rng.seeded(room.seed)`: shape from `cols/rows`
  or `picture` (`parseShape`), ids `idBase + 1..`. For par k: press k distinct random real cells, keep the board when
  the solver's fewest presses is exactly k and the room has no such board yet. Out of tries → highest par found + warning.
- `list`: classic first (ids 1..50, at `list[id − 1]`, no pack fields), then room levels with `pack`, `index`, `shape`.
- `packs`: classic first, then rooms in data order, names from copy. Bad rooms (overlapping ids, no name, par above the
  cell count, bad picture) stop the game with a plain message. ~7–18 ms for all 122 levels in Node.
- `start()` emits `levels:generated {count, pars}` about the classic path only.
- `levels:start {levelId}` → `board:load {…, shape?}` + `levels:started {levelId, par, count, pack, index, next}`
  (count = levels in that pack, next = following id in the pack or null). Refused `not_ready`, `unknown`, or `locked`:
  classic above `progress.unlockedUpTo`; a room level unless `progress.varietyOpen` and `index ≤ progress.packs[room].unlockedUpTo`.
  No progress slice → everything open.
- Console: `levels.start <id>`, `levels.list` (id: par, with pack and index for rooms).
