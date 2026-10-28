# solved-sheet

The end-of-level sheet in `view.region('sheet:solved')`. Uses `view`, `clock`; owns no slice.

- `board:solved {levelId, moves, par}` → after `rules.json → solved-sheet.delayMs` (640: the sheet's slide overlaps the sweep's tail)
  emits `nav:open_sheet {sheet:'solved'}`. Cancelled by `levels:started`, `board:loaded`, `board:restarted`, or leaving play.
- Stars come from `progress:level_completed` for the same level, before or after `board:solved`. Hint-lost stars show as outlines.
- `levels:started {pack, index, next}` is kept (order-independent); without it (hot reload) the place comes from the levels slice.
- Shows: eyebrow "Level 7" (rooms: "Small room · Level 3"), "Lights out.", `[data-stars-earned]`, `[data-result]` "6 moves · par 5",
  and a note only when it says what to do (over par, or hinted). No drag handle.
- After a boss (`levels:started.boss`, else the level's def): `data-boss="true"`, a skull over the title, "Boss beaten." Same star rules.
- `next` → `levels:start {next}` ("Next · Level 8", hidden when next is null), `replay`, `levels` → `variety:open {room: pack}` (this board's
  level screen, classic included; home when no `variety` slice). Last level of a board: "Back to the levels" is primary (classic: all-done copy).
- A custom puzzle (`CUSTOM_LEVEL_ID`): eyebrow = `custom.label`; "New puzzle" → `custom:play`, Replay → `board:restart`, "Change board" → `custom:open`.
- The backdrop does nothing. Copy: `copy.json → solved-sheet`. Layout: `--sheet-pad` all round, every button `--bar-h` tall (`--bar-h-short` on short screens).

Delete it and a solve just leaves the dimmed board with its back button.
