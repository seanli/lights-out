# progress

Stars, best moves, unlocks and pending hint costs. Owns the `progress` slice `{ status, save: ProgressSaveV1, unlockedUpTo, scoring }`.
Optional services: `storage`, `view` (works in memory without storage). Rules: `rules.progress`; copy: `copy.progress`.

- Load: `storage.get(saveKey)`. Missing → `new`. Valid → `saved`. Old version → `MIGRATIONS` in `save.ts` (empty for now) → `saved`. Otherwise → `recovered`: keeps the level results that still parse, backs up the bad value to `<saveKey>.backup` (or `.backup-<time>` if one exists), and shows an info notice. If the backup can't be written, the original is never overwritten this visit.
- `progress:loaded {source, solved, unlockedUpTo}` from `start()`.
- `unlockedUpTo` = highest solved id + 1, capped at the levels count when the `levels` slice is ready.
- `levels:started` → `lastLevel`. `hints:shown` → `pendingHints[id] += 1` (survives Restart and reload).
- `board:solved` → stars = tier(moves − par) − hints × hintCost, min `minStars`. Keeps the best stars and fewest moves, clears pending hints, then emits `progress:level_completed`.
- `progress:clear` → fresh save, `progress:cleared`.
- Every change saves at once. On failure: `progress:save_failed {reason}`, plus a warn notice `progress-save` shown once (cleared when saving works again; skipped in memory mode, where storage already says so).
- Console: `progress.stars`, `progress.unlock [n]` (1..n solved at 3★), `progress.clear`.
