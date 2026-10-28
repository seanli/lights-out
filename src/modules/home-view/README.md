# home-view

The menu (The Good Sudoku pattern, DECISIONS #42). Renders `view.region('screen:home')` and `sheet:confirm_reset`. Uses `view`; owns no slice.

- Reads `levels` (`packs`), `progress`, `storage`, `sound`, `learn`, `variety`, `nav`. Rows are rebuilt only when `packs` changes; they repaint in place.
- Header: logo, "Lights Out", a quiet sound icon (`sound:set`, aria-pressed), and the star chip: every board's stars added up.
- `[data-action="continue"]` → `levels:start` for `suggest()`: the board of `save.lastLevel` (classic when unknown or locked), its lowest
  startable unsolved level; else classic's; else the first board with one; all solved → the last played level.
  Label "Start · Level 1" (fresh), "Continue · Level 7", "Continue · Ring 4". Caption "x of y solved" over the open boards,
  plus "Progress is saved on this device" at 0 solved. Until classic level 3 is solved, "New here? Learn the patterns" sits under it.
- "Boards": one 64px+ row per pack, hairlines between: `[data-room-tile][data-room][data-solved][data-stars][data-locked]` with the
  shared `roomGlyph`, name, meta ("5×5 · 50 levels", "12 levels" for shapes), "solved/count" and "★ stars" → `variety:open {room}`.
  Rooms are locked until `progress.varietyOpen`: aria-disabled, dim glyph, "Opens after level 20", inert. Hidden without a `variety` slice.
- Learn row (`learn:open {}`) while a `learn` slice exists. Reset is a quiet text button → `nav:open_sheet {confirm_reset}` → `progress:clear`.
- Copy: `copy.json → home-view`. Layout CSS in `home-view.css` (tokens only).

Delete it and the game opens on an empty home screen; everything else still boots.
