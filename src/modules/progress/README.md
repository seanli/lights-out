# progress

Stars, best moves, unlocks and pending hint costs. Owns `progress`: `{ status, save: ProgressSaveV1, unlockedUpTo, scoring, packs, varietyOpen }`.
Optional services: `storage`, `view` (works in memory without storage). Rules: `rules.progress`; copy: `copy.progress`.

- Load: `storage.get(saveKey)`. Missing → `new`. Valid → `saved`. Old version → `MIGRATIONS` in `save.ts` (none yet) → `saved`. Otherwise → `recovered`: keeps the level results that still parse, backs up the bad value to `<saveKey>.backup` (or `.backup-<time>`), and shows an info notice. If the backup can't be written, the original is never overwritten this visit.
- The save stays v1: room results are keyed by their ids (1001+) like any level, so old saves load unchanged.
- `unlockedUpTo` / `allSolved` count only classic ids (1..classic count). `packs[room]` = `{ unlockedUpTo: highest solved index + 1 (≥1, ≤count), solved, stars }`. `varietyOpen` = classic level `varietyAfter` is solved.
- `levels:started` → `lastLevel` (classic only: a room level never becomes Continue). `hints:shown` → `pendingHints[id] += 1`.
- `board:solved` → stars = tier(moves − par) − hints × hintCost, min `minStars`; keeps the best, clears pending hints, emits `progress:level_completed` with `pack` and `unlocked` (next level in the same pack, or null).
- `progress:clear` → fresh save, `progress:cleared`. Every change merges with storage, then saves; on failure `progress:save_failed` + a warn notice once.
- Console: `progress.stars`, `progress.unlock [n]` (classic 1..n at 3★), `progress.clear`.
