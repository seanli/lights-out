# learn

The Learn screen (`screen:learn`): five lessons, at most five short steps each (one idea per step). Owns the `learn` slice.

- `learn:open {lessonId?}` → lesson (or the list), step 0, `learn:lesson_opened`, `nav:go learn`. Unknown id → `learn:refused`.
- `learn:step {delta}` → Previous/Next; past the last step completes the lesson (`learn:lesson_completed`) and returns to the list.
- Practice: `learn:new_practice` / `learn:press {index}` on a mini board (`solver.press`); `learn:practice_solved`. Never touches stars.
- Lesson 4 teaches **echoes**: a top-row tap, chased down, leaves its echo; the leftover bottom row is an echo (or two stacked), so tapping that top light and chasing again cancels it. "Go deeper" on its last step opens `echo-more` (not in the list, never "completed"): five rules over the 7 rows, how an echo forms (row rule, `echoRows`), and a "whose echo is this?" drill (`drill.ts`: Leitner boxes, 10 cards, misses return 3 cards later, saved under `rules.json → learn.drill.saveKey`). Any top-row set that clears the row is accepted.
- Maths (`method.ts`) comes from the solver: the bottom-row table, quiet patterns, echoes. `RULES` (lessons.ts) is presentation only; tests prove each rule clears its rows.
- In-game Patterns panel (`reference.ts` → `slot:reference`): classic 5×5 shows status, the matching row's "Echo of X · rule" line, the live bottom row and the 7-row table. It scrolls the match into view, and fades the bottom edge while there is more (ResizeObserver). On screens ≤740px tall, once a row matches, only the rule and that row show. Other full rectangles get row-by-row chase advice (bottom row only → Hint). Shaped rooms get one line. It never marks the main board.
- Every sentence is in `copy.json → learn`; the mini board lives in `learn.css` (tokens only). Saves completed ids under `rules.json → learn.saveKey`.
- Services: uses `view`, `solver`, `rng`; optional `storage`, `clock`. Console: `learn.open [lessonId]`, `learn.table`.
