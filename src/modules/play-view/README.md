# play-view

The play screen, rendered into `view.region('screen:play')`. Owns no slice; reads `board`, `hints`, `tutorial`, `levels` (chapters), `progress` (`pendingHints`, `scoring`).

- Built once; each slice change updates only the attributes/text that differ (a tap touches ≤ 5 cells).
- Cells press on `pointerdown` (primary button / any touch) → `board:press {index}`; the trailing click is swallowed.
  Keyboard Enter/Space (click with `detail === 0`) presses too; arrows/Home/End move focus (roving tabindex).
- Header: `[data-action="back"]` → `nav:go {screen:'home'}`; `[data-action="learn"]` → `learn:open {}`; "Chapter N" / `[data-level-label]`;
  max stars still possible (3 − hints × hintCost, ≥ minStars) with "Max · Hint used". Tier chips from `progress.scoring` (hidden without it).
- Actions: undo (aria-disabled without history or when not playing), restart (moves 0), hint (hidden without a `hints` slice; disabled while showing).
- Hint: `data-hint="true"` on `hints.cell` + the hint line. Tutorial: `data-pointer="true"` on `tutorial.target`; `slot:coach` sits under the board.
- Solve: `data-status="solved"` + `.board--sweep`, each cell's `--i` = distance from the winning tap scaled to `--dur-sweep`; skipped under reduced motion.
- Data: `copy.json → play-view`. Module-scoped CSS in `play-view.css` (see `requests.md`).
- Console: `debug` shows the hint/pointer cells, focused cell and whether the sweep is running.
