# play-view

The play screen, rendered into `view.region('screen:play')`. Owns no slice; reads `board` (incl. `shape`), `hints`, `tutorial`, `levels` (chapters, packs), `progress` (`pendingHints`, `scoring`).

- Any board: `shape` absent = 5×5. The grid is rebuilt only when the shape changes; `.board` gets `data-n` (max side), `data-cols`, `data-rows`. Real cells are `button[data-cell][data-index]`; gaps are `[data-gap]` (aria-hidden, never focusable, no part in sweep/flip/focus).
- Presses on `pointerdown` → `board:press {index}`; the trailing click is swallowed; Enter/Space press. A press in the board's gutter/padding presses the real cell whose grid slot holds the point (`grid.ts`); a gap's own slot does nothing.
- Arrows/Home/End rove over real cells only, skipping gaps.
- Header `[back] Chapter · Level [patterns]`; on a Variety level the eyebrow is the room name (`levels.packs`) and the title its index in the room. The Patterns button shows on every board (with a `learn` slice).
- Tier chips from `progress.scoring` (aria-label: max stars still possible); after a hint a `chip[data-state="hint"]` "−1★ hint" joins them.
- Moves/Par: centred pair; the moves numeral gets `stat__value--bump` per change.
- Feel: changed cells get `data-flip` (removed on animationend) and `--flip-delay` (pressed cell 0ms, neighbours `var(--flip-stagger)`; undo/restart 0ms). A new level adds `.board--intro` (lit cells by `--i` = row+col), ended by the first press or a timer. Coaching sets `data-coaching="true"` on the screen.
- Solve: `.board--sweep`, each real cell's `--i` = distance from the winning tap scaled to `--dur-sweep`. All motion skipped under reduced motion.
- Pattern reference: `[data-action="reference"]` toggles `slot:reference`; waits for a lifted finger; Escape closes; board/stats/actions FLIP.
- A tap writes attributes on the changed cells only, with no layout reads. Data: `copy.json → play-view`. Layout in `play-view.css`.
