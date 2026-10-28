# learn

The Learn screen (`screen:learn`): "Basics" (five classic lessons) and "Board guides" (one per room in `levels.packs` with copy in `learn.guides`). At most five short steps each, one idea per step. Owns the `learn` slice.

- `learn:open {lessonId?}` → lesson, guide (`guide-<room id>`) or the list, step 0, `learn:lesson_opened`, `nav:go learn`. Unknown id (or no rooms yet) → `learn:refused`. Opened from another screen, Back and Done return there (`nav:back`).
- `learn:step {delta}` → Previous/Next; past the last step completes it (`learn:lesson_completed`, saved under `rules.json → learn.saveKey`).
- Practice: `learn:new_practice` / `learn:press {index}` on a mini board of the lesson's shape (gaps drawn empty, never cells); `learn:practice_solved`. Never touches stars.
- Lesson 4 teaches find-your-row, tap its top light, chase again; "Go deeper" (`echo-more`, `shortest-more`) holds the theory and the drill (`drill.ts`).
- Guides (`guides.ts`) pick their steps from the maths: chase clears all (4×4); one bottom light → its top taps, tap a strip to watch it (6×6, 7×7); tap shapes, then chase → top-edge fix → chase (Cross, Ring, Diamond). Example boards come from fixed-order searches on the real shape.
- Maths (`method.ts`) comes from the solver: the classic table, quiet patterns, echoes, per-light top taps (`rectTopSets`), and for any shape the chase, start/end cells and `createFixer` (fewest start taps whose chase leaves a leftover). Tests prove each claim on every room.
- Marks: "tap here" is the tutorial's dashed pointer (with the letter on strips); illustrations get a quiet dot; teal stays the paid Hint's.
- Patterns panel (`reference.ts` → `slot:reference`, never marks the main board): classic shows the 7-row table; full rectangles the size's rule and the bottom row over its top taps; shaped rooms "Row N: tap under…", then the board's picture with the fix ringed. Rooms link to their guide (`[data-action="guide"]`), classic to all lessons. Readable at 320×568.
- Every sentence is in `copy.json → learn`; styles in `learn.css` (tokens only). Services: `view`, `solver`, `rng`; optional `storage`, `clock`. Reads `levels` (rooms) and `progress` (tile glyphs). Console: `learn.open [id]`, `learn.table`.
