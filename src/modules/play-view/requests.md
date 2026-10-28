# play-view requests

## Done in the UI consistency pass (play builder)
- The play screen's layout lives in the design system (`components.css`, "play screen"); `play-view.css` keeps only the boss skull,
  the touch-surface rule and the desktop width. Portrait is a flex column; side by side is the same column wrapped into two (no grid areas).
- The open/closed FLIP is gone (`flip.ts` deleted): the board snaps to its new size, the panel fades in 8px.

## Open
1. **Token `--rest-opacity`** (Undo / Restart with nothing to take back: .55, softer than `--disabled-opacity`). Used as
   `var(--rest-opacity, .55)` in `components.css` until it exists.
2. **Design gallery** (`design/system.html`, not mine): its play mock still has the old DOM (stats outside the slot, `.btn--stack` tools).
   The play screen is now `header · .play-status (.play-stats + .play-tiers) · .board-slot (.play-line + .board) · .play-reference · .bar.bar--icons.play-actions`.
3. **learn.css** (learn builder): the shared line `.learn-link, .reference__lessons { … }` can drop `.reference__lessons`; the panel's link is
   `.btn--link.reference__link` now.
4. **Audit script** (`.cache/audit.mjs`): it shoots with `#debug`, and the collapsed console reserves 56px at the bottom of `.app`, so every
   screen is 44px shorter than a player's (320×568 behaves like 320×524). `scripts/look.mjs` now removes the console before shooting
   (except `--state console`); the audit could do the same (`document.querySelector('[data-console]')?.remove()`).
5. **Panel rule copy** is pinned by regexes in `learn.test.ts` ("two to each side; at the edges, also", "above it and two to each side; at
   the edges, skip"). The 10×10 line is 3 lines at 360px wide, so it hides there (whole or not at all, leaving a two-line gap); a shorter
   wording needs those tests loosened.
6. **Aim bubble** (`src/lib/aim.ts`): tiles are `--space-8` (32px), so on 10×10 at 390 (35px slots) it shows the neighbourhood but barely
   magnifies; `--tap-min` tiles with `BUBBLE_GAP` ≈ 90 would.
