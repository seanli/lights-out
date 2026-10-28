# learn

The Learn screen (`screen:learn`): five lessons that teach the patterns that solve any board. Owns the `learn` slice.

- `learn:open {lessonId?}` → lesson (or the list when omitted), step 0, `learn:lesson_opened`, then `nav:go learn`. Unknown id → `learn:refused`.
- `learn:step {delta}` → prev/next; past the last step marks the lesson completed (`learn:lesson_completed`) and returns to the list.
- Practice: `learn:new_practice` builds a board from N taps (N from `rules.json → learn.practicePresses`, cells from `rng`); `learn:press {index}` uses `solver.press`; solved → `learn:practice_solved {lessonId, moves, par}`. Never touches stars or progress.
- `learn:set_assist {on}` rings the next tap (`practice.suggest`): chase taps in lesson 3, the full method (chase → table → chase) in lesson 4.
- Maths (`method.ts`) is derived from the solver at init: the bottom-row table (7 entries) and the 3 quiet patterns. Nothing hard-coded.
- Lesson shapes in `lessons.ts`; every sentence in `copy.json → learn`. Demos auto-play with the `clock` service, step by tap under reduced motion.
- Mini board `.board--mini` lives in `learn.css` (tokens only). Practice cells press on `pointerdown`, keyboard via click + arrow keys.
- Saves completed lesson ids under storage key `learn` (`rules.json → learn.saveKey`); without storage they last until the page closes.
- Services: uses `view`, `solver`, `rng`; optional `storage`, `clock`. Console: `learn.open [lessonId]`, `learn.table`.
