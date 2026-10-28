# play-view requests

## Design system (src/shell/styles/components.css): absorb play-view.css
The play view adds four small rules in `src/modules/play-view/play-view.css` (tokens only). Suggested home: components.css.
1. `.screen-header__end` holding two things side by side (max-stars block + the Learn icon button):
   `.play-head-end { flex-direction: row; align-items: center; gap: var(--space-2) }` and a `.play-max` column (stars over caption, `white-space: nowrap`).
   Perhaps a `.screen-header__end--row` modifier.
2. `.play-line`: one fixed-height line under the board that holds either the hint line or `slot:coach` (the hint wins).
   In short landscape it needs `grid-area: line` (components.css only assigns that area to `.tutorial-line` as a direct child).
3. `.board-slot[data-tiers="false"]` sets `--board-chrome-y` without the chip row, so the board grows when `scoring` is absent.
4. `.board` itself as a touch surface: `touch-action: manipulation; user-select: none; -webkit-touch-callout: none` (cells have it; gaps between cells did not).

## Copy
Added to `copy.json → play-view`: `board`, `learn`, `maxAria`, `tierWithin`, `tierOver`, `tierWithinAria`, `tierOverAria`.
After a hint the header caption says "Hint used" (not "Max · Hint used"): with the Learn button in the same corner, the long caption wrapped onto two lines at 375px.
