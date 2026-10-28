# play-view

The play screen, rendered into `view.region('screen:play')`. Owns no slice; reads `board` (incl. `shape`), `hints`, `tutorial`, `levels` (chapters, packs), `progress` (`pendingHints`, `scoring`).

- One anatomy (layout: `components.css`, "play screen"): `header.screen-header`, `.play-status`, `.board-slot` (`.play-line` over the `.board`), `.play-reference`, `.play-actions` (the shared `.bar.bar--icons`). Opening Patterns only shows the panel above the tools; the board snaps to its new size (no FLIP, nothing else moves). Side by side (landscape phones; tablets while open) the same blocks wrap into two columns.
- Any board: `shape` absent = 5×5. The grid is rebuilt only when the shape changes; `.board` gets `data-n` (max side), `data-cols`, `data-rows`. Real cells are `button[data-cell][data-index]`; gaps are `[data-gap]` (aria-hidden, never focusable, no part in sweep/flip/focus).
- Presses by measured board (`src/lib/aim.ts`): normally on `pointerdown` → `board:press {index}` (trailing click swallowed);
  a tall board (rows ≥ 2 × cols, the Tower) gets `data-scroll="true"`, fits its width, scrolls, presses on release unless the finger moved,
  starts each level at the top and scrolls a new hint/pointer into view; a slot (board / cols, gutter included) under `--aim-below`
  (ResizeObserver + each grid build) gets `data-aim="true"`: hold shows the bubble, slide, lift to press. Clicks never press twice; Enter/Space press.
  The gutter/padding presses the real cell whose grid slot holds the point (`grid.ts`); a gap's own slot does nothing. Arrows/Home/End rove over real cells.
- Header `[back] Chapter · Level [patterns]`; on a Variety level the eyebrow is the room name (`levels.packs`) and the title its index in the room.
  A boss (`levels.list[].boss`): `data-boss="true"` on the header, a skull before the level, eyebrow "Cathedral · Boss" (`copy.boss`), warm accent.
- Status row: Moves (display numeral, bumps per change) and Par as a pair; tier chips from `progress.scoring` (aria-label: max stars still possible),
  after a hint a `chip[data-state="hint"]` "−1★". `data-long` on `.play-tiers` (limits ≥ 10) lets the row fold the "≤N" limits sooner: it never wraps.
- The line over the board: the hint line or the tutorial's `slot:coach`, shown whole in the spare height or not at all; while coaching the board leaves it room.
- Feel: changed cells get `data-flip` and `--flip-delay` (pressed cell 0ms, neighbours `var(--flip-stagger)`). A new level adds `.board--intro`. Coaching sets `data-coaching="true"`.
- Solve: `.board--sweep`, each real cell's `--i` = distance from the winning tap scaled to `--dur-sweep`. All motion skipped under reduced motion.
- Pattern reference: `[data-action="reference"]` toggles `slot:reference`; waits for a lifted finger; Escape closes.
- A tap writes attributes on the changed cells only, with no layout reads. Data: `copy.json → play-view`.
