# home-view requests

Done in the UI consistency pass (shell builder): #1 `.btn--danger`, #2 `.screen--scroll` reaches the screen edges
itself, #6 `.menu-list` / `.menu-row` (all in `components.css`).

3. **Progress: record room levels in `save.lastLevel`.** Continue starts "the board last played" (dom.ts, DECISIONS #42), but
   `progress` ignores `levels:started` for room levels, so today Continue only reaches a room once classic has nothing open.
   `suggest()` already handles a room id in `lastLevel`. Change: in `progress`, drop the `pack !== 'classic'` early return.
4. **Progress: expose the rooms' gate.** The locked row reads "Opens after level 20" from copy; the 20 is `rules.json → progress.varietyAfter`.
   If the progress slice carried `varietyAfter`, the copy could be "Opens after level {level}" and never drift.
5. **`src/lib`: one board tally.** `tally(pack, progress)` (open, highest startable index, solved, stars) is the same 15 lines in
   home-view and variety (modules can't share code). Proposed `src/lib/boards.ts`.
7. **Levels: say which boards scroll.** The Tower's menu line reads "6×16 · scrolls · 30 levels"; the note is `copy.json →
   home-view.boardNotes` keyed by pack id. If `Pack` carried `scrolls?: true` (set by levels from the rule play-view uses), the
   menu would follow the data. (The board screen's eyebrow no longer shows it: it must fit one line at 320.)
8. **Learn header copy (for the learn builder, via the lead).** The shared header gives the eyebrow and the title one line each,
   184px wide at 320 (about 22 tracked caps). `learn.subtitle` "Patterns that solve any board" measures 230px and ends in "…".
   Proposed: `"subtitle": "Solve any board"` (120px), or "Lessons and guides" (146px). Lesson titles fit at 320 (the title
   steps down to 18px under 360px; the widest, "Chase the lights down", is 182px there). In the Learn list as `.menu-row__title`
   they stay on one line at 375 (about 240px free beside a 40px glyph and a done mark).
