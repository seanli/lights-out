# play-view

The play screen, rendered into `view.region('screen:play')`. Owns no slice; reads `board` (incl. `shape`), `hints`, `tutorial`, `levels` (chapters, packs), `progress` (`pendingHints`, `customHints`, `scoring`), `custom` (label, puzzle number).

- One anatomy (layout: `components.css`, "play screen"): `header.screen-header`, `.board-slot` (`.play-line`, then `.play-status` right above the `.board`; the status row takes the board's measured width, `--play-board-w`, and the pair is centred in the area), `.play-reference`, `.play-actions` (the shared `.bar.bar--icons`). Opening Patterns only shows the panel above the tools; the pair moves up into the spare space first and the board shrinks only when it must (no FLIP). Side by side (landscape phones; tablets while open) the same blocks wrap into two columns.
- Any board: `shape` absent = 5×5. The grid is rebuilt only when the grid changes (size, gaps, `grid`); a level's stuck cells and wiring are redrawn on the same cells (`.cell__mark`: circuit traces, a riveted hazard plate; `data-stuck`, `data-wires`, words in the label). `.board` gets `data-n`, `data-cols`, `data-rows`, `data-grid="hex|cube"`. Real cells are `button[data-cell][data-index]`; square gaps are `[data-gap]`. Hex: hexagon tiles (`.cell__face`, clipped) placed by `--hx`/`--hy` on half-columns, odd rows shifted, centred by `hexSpan`; a tap goes to the nearest tile centre (`grid.ts hexCellAt`). Cube: six `.cube__face` panels folded by `lib/cube.ts` frames; tilted view; swipe (Shift+arrows) = quarter turn, the cube follows the finger; presses on release; `[data-cube-line]` counts lit lights out of sight; a hint turns its face to the front. A stuck tap shakes (`data-jam`).
- Presses by measured board (`src/lib/aim.ts`): normally on `pointerdown` → `board:press {index}` (trailing click swallowed);
  a tall board (rows ≥ 2 × cols, at most 8 across: the Tower) gets `data-scroll="true"`, fits its width, scrolls, presses on release unless the finger moved,
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
