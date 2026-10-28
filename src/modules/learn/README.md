# learn

The Learn screen (`screen:learn`): five lessons, at most five short steps each (one idea per step). Owns the `learn` slice.

- `learn:open {lessonId?}` → lesson (or the list), step 0, `learn:lesson_opened`, `nav:go learn`. Unknown id → `learn:refused`.
- `learn:step {delta}` → Previous/Next; past the last step completes the lesson (`learn:lesson_completed`) and returns to the list.
- Practice: `learn:new_practice` / `learn:press {index}` on a mini board (`solver.press`); `learn:practice_solved`. Never touches stars.
- Lesson 4 teaches one move: find your bottom row, tap the top light it shows, chase again (the row is that light's echo). Its practice names the echo once only the bottom row is left. "Go deeper" (`echo-more`, `shortest-more`; not in the list, never "completed") holds the rules, stacked echoes, how an echo forms, the drill (`drill.ts`: Leitner boxes saved under `learn.drill.saveKey`; any clearing set counts) and the no-change taps.
- Marks: "tap here" uses the tutorial's pointer (dashed warm ring, plus the light's letter on strips); illustrations get a quiet dot; teal stays the paid Hint's.
- Maths (`method.ts`) comes from the solver: the bottom-row table, quiet patterns, echoes, and per-light top taps for full rectangles (`rectTopSets`). `RULES` is presentation; tests prove each clears its rows.
- Patterns panel (`reference.ts` → `slot:reference`, never marks the main board): classic shows status, "Echo of X", live row and the 7-row list. The match scrolls into view, the bottom edge fades while more is below, and ≤740px shows only the matching row. Full rectangles: the size's strategy line, then your bottom row over the top taps. Shaped rooms: one line.
- Every sentence is in `copy.json → learn`; the mini board lives in `learn.css` (tokens only). Saves completed ids under `rules.json → learn.saveKey`.
- Services: uses `view`, `solver`, `rng`; optional `storage`, `clock`. Console: `learn.open [lessonId]`, `learn.table`.
