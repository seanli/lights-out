# home-view

The level path. Renders `view.region('screen:home')` and the reset confirmation `sheet:confirm_reset`. Uses `view`; owns no slice.

- Reads `levels`, `progress`, `storage`, `sound`, `learn`, `nav` via `ctx.watch`. The path DOM is rebuilt only when the levels list changes; tiles update in place.
- Header: logo glyph, "Lights Out", star total chip (sum of best stars / count×3; hidden without progress).
- `[data-action="continue"]` → `levels:start` for the lowest unlocked unsolved level (all solved → last played; nothing solved → "Start · Level 1"). Caption drops "saved on this device" unless storage is `ok`.
- Chapters from `levels.chapters`: header + `.level-grid` of `[data-level-tile]` (stars/locked/current). Locked tiles stay focusable with a "locked" label and do nothing. A chapter whose first level is locked shows the dashed `.chapter[data-locked]` card.
- Footer: Learn (`learn:open {}`, shown only when a `learn` slice exists), star legend from `progress.scoring`, sound toggle (`sound:set`, aria-pressed; hidden without a sound slice), reset → `nav:open_sheet {confirm_reset}`.
- Reset sheet: confirm → `progress:clear` + `nav:close_sheet`; cancel/Escape → `nav:close_sheet`. Focus starts on cancel.
- When home shows, the current tile is scrolled to centre only if it is off-screen (no smooth scroll).
- Copy: `copy.json → home-view`. Layout CSS in `home-view.css` (tokens only).

Delete it and the game opens on an empty home screen; everything else still boots.
