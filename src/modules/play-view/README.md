# play-view

The play screen, rendered into `view.region('screen:play')`. Owns no slice; reads `board`, `hints`, `tutorial`, `levels` (chapters), `progress` (`pendingHints`, `scoring`).

- Built once; each slice change updates only the attributes/text that differ (a tap touches ≤ 5 cells).
- Cells press on `pointerdown` (primary button / any touch) → `board:press {index}`; the trailing click is swallowed.
  Keyboard Enter/Space (click with `detail === 0`) presses too; arrows/Home/End move focus (roving tabindex).
- Header: `[data-action="back"]` → `nav:go {screen:'home'}`; "Chapter N" / `[data-level-label]`; "Up to" ★★★ still possible
  (3 − hints × hintCost, ≥ minStars) + "Hint used". Tier chips from `progress.scoring` (hidden without it).
- `[data-action="reference"]` (hidden without a `learn` slice) toggles the pattern reference: `slot:reference` sits in `.play-reference`,
  the screen gets `data-reference="open|closed"`. Instance state: survives level changes. Escape closes it. A toggle during a board press
  waits for the finger to lift. The board, stats and actions FLIP to their new places (skipped under reduced motion).
- Actions: undo (aria-disabled without history or when not playing), restart (moves 0), hint (hidden without a `hints` slice; disabled while showing or while the tutorial coaches).
- Hint: `data-hint="true"` on `hints.cell` + the hint line. Tutorial: `data-pointer="true"` on `tutorial.target` (never together with a hint mark); `slot:coach` sits under the board.
- Solve: `data-status="solved"` + `.board--sweep`, each cell's `--i` = distance from the winning tap scaled to `--dur-sweep`; skipped under reduced motion.
- Data: `copy.json → play-view`. Module-scoped CSS in `play-view.css` (see `requests.md`).
- Render skips unchanged slices; the header redraws only when level, moves or par change. Console `debug`: hint/pointer cells, focus, sweep.
