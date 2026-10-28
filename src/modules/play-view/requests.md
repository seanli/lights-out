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

## Pattern reference layout (play-view.css)
`.screen--play[data-reference="open"]` portrait rows: header / board (min = 5 tap-size cells) / stats + icon-only actions / panel (`fit-content(42%)`).
Wide or short-landscape: board left; head, stats, panel, actions right, centred against the board. The `.app` widens via `:has()`.
The stats moved into `.board-slot` (closed layout) so stats + tiers + board centre as one group between header and actions; `--board-chrome-y` includes them.
If the design system adopts these, the rules can move to components.css.

## Polish pass (for the design-system owner)
- `play-view.css` sets `grid-template-columns/rows` from `--board-cols`/`--board-rows` (set inline with `--board-n`) so a non-square shape would lay out; components.css only knows `--board-n`.
- C1 layout lives in `play-view.css`: the slot is `justify-content: flex-end`; the rest space under the line is a `margin-bottom` that only takes height the board can't use (`clamp(0px, free height, clamp(12px, 3vh, 24px))`), so 375×667 and 320×568 keep the full board.
- Disabled actions use `var(--rest-opacity, .55)`; desktop play widens `.app` to `var(--app-max-play, 560px)`. Tokens welcome.
- Below 390px the tier chips tighten (`--space-2` padding); below 360px the hint chip's word is visually hidden ("−1★" stays, the aria-label says it all).
- Short portrait (`max-height: 640px`): stats on one baseline line (Moves `--text-xl`, Par `--text-lg`), `--space-2` gaps, compact action height (`--btn-h-compact`). 320×568 (#debug): board 238 → 288px, 7×7 slot 34 → 41px.

## Big boards (round 3)
- **Styles README** (`src/shell/styles/README.md`, not mine to edit): "Board sizing" still describes the square `--board-size`.
  The play board (`.board[data-n]`) now sizes square cells from a fit box: `--fit-w: min(100cqw, --board-max)`,
  `--fit-h: min(100cqh - --board-chrome-y, --board-max)`; `width`/`height` follow `--board-cols × --board-rows`. Layouts that move the
  board set `--fit-w/--fit-h` (short landscape, the open Patterns panel, the no-container-query fallback). `.board[data-scroll="true"]`
  fits its width (cells ≤ `--cell-max-tall`) and scrolls; its window ends mid-row where `round()` exists. Learn's `.board--mini` is untouched.
- The air above the actions is now a shrinkable `.board-slot::after` spacer (the old margin calc assumed a square board).
- **Aim bubble** (`src/lib/aim.ts` + `.aim-bubble`): tiles are `--space-8` (32px), so on 10×10 at 390 (32px cells) it shows the
  neighbourhood but doesn't magnify. Suggest `--tap-min` tiles with `BUBBLE_GAP` ≈ 90 so the bubble still clears the finger.
- **Threshold**: aim mode follows the rule (slot < `--tap-min`), so 7-wide boards (7×7, Cross, Ring, Diamond) aim at 320×568 (41px slots).
  If instant presses are preferred there, compare against 40px instead (one number in `measureSlot`).
- **Page weight**: the build is 285.8KB raw / 102.7KB gzip (target #41: ≤ 280KB / ≤ 105KB). The aim helper and skull are now bundled
  (they were tree-shaken before) plus the board/scroll CSS: about +6KB. Needs a retune or a trim elsewhere.
