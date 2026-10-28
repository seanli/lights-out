# home-view

The classic level path and the doors to Variety and Learn. Renders `view.region('screen:home')` and `sheet:confirm_reset`. Uses `view`; owns no slice.

- Reads `levels`, `progress`, `storage`, `sound`, `learn`, `variety`, `nav`. Counts, stars and Continue are about the classic pack only
  (`packs` → classic count; `levels.list` also holds the rooms). The path DOM is rebuilt only when the list changes; tiles update in place.
- Header: logo, "Lights Out", a quiet sound icon (`sound:set`, aria-pressed) and the star total chip ("/ 150" hidden below 360px).
- `[data-action="continue"]` → `levels:start` for the lowest unlocked unsolved level. Caption says "saved on this device" only at 0 solved.
  Until level 3 is solved a "New here? Learn the patterns" link sits under it.
- Chapters: `.level-grid` of `[data-level-tile]`. Locked tiles are dark sockets (no padlock), solved tiles warm, 3★ glows.
  A tile unlocked by a classic solve (`progress:level_completed.unlocked`) powers on once when home next shows. Chapters ahead are one quiet row.
  The star legend is one line under chapter 1.
- Variety entry `[data-action="variety"]` (only with a `variety` slice and rooms): locked → quiet row "Variety opens after chapter 1"
  (aria-disabled, inert); open → a card with each room's shape glyph → `variety:open {}`.
- Footer: Learn (`learn:open {}`), Reset as a quiet text button → `nav:open_sheet {confirm_reset}`; confirm → `progress:clear`.
- Copy: `copy.json → home-view`. Layout CSS in `home-view.css` (tokens only).

Delete it and the game opens on an empty home screen; everything else still boots.
