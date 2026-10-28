# Design system (`src/shell/styles`)
Import order: `fonts.css`, `tokens.css`, `components.css`. Components use tokens only. Gallery: `design/system.html` (`?play` = play screen alone).
One dark look (`color-scheme: dark`). With `prefers-reduced-motion`, all `--dur-*`, staggers, scales and pulses go to 0/1.
Text: `--c-text` 13–15:1, `--c-text-dim` ≥ 5.1:1, `--c-text-faint` ≥ 4.5:1 on every surface up to `--c-surface-2`; nothing below `--text-2xs` 11px.
Fonts are bundled woff2 (Fraunces 600, Manrope 500/700, Latin only, 45 KB). ≤ ★ → render in the fallback face.

| Class | Variants / parts | States (what drives them) |
|---|---|---|
| `.app` | the single column, 480px max (880px in short landscape), safe-area gutters | `height:100%` |
| `.screen` | `.screen--play` (grid: header, stats, `.board-slot`, actions), `.screen--scroll` | `[hidden]`, `[data-enter="forward"\|"back"]` (shell: 200ms fade in, ±12px) |
| `.screen-header` | `> button` · `__title` (`.eyebrow` + `strong`) · `__end` (right slot) | |
| `.btn` | `--primary` `--secondary` `--ghost` `--icon` `--hint` `--block` `--stack` (icon over label), `__meta` | `:hover` `:active` (scale) `:focus-visible` `:disabled` `[aria-disabled="true"]` `[aria-pressed="true"]` |
| `.board-slot` | size container holding `.play-tiers`, `.board`, `.tutorial-line` | |
| `.board` | `.board--sweep` (warm wash; `--i` = distance), `.board--intro` (lit cells power on by `--i`); `> [data-gap]` keeps its slot, invisible | `[data-status="playing"\|"solved"]` (solved = dimmed, inert), `[data-n="4".."10"]` (gap, pad, radius, glow scale with the cell), `[data-scroll]`, `[data-aim]` |
| `.cell` | button per light | `[data-lit]` (fades `--lit` over `--dur-flip` after `--flip-delay`) `[data-flip]` (bloom on / afterglow off; remove on `animationend`) `[data-hint="true"]` `[data-pointer="true"]` `:active` (lit: brighter) `:focus-visible` |
| `.stat` | `.eyebrow` + `.stat__value`; `--end` (right-aligned), `--muted` | `.stat__value--bump` (one 160ms pop; restart it per change) |
| `.chip` | `--lg` (star total), `__of`; group in `.play-tiers` | `[data-state="now"\|"lost"\|"hint"]` |
| `.stars` > `.star` | `.stars--xs/--md/--lg`, `.stars--reveal` (staggered fill-in) | `.star[data-state="on"\|"off"\|"lost"]` |
| `.level-grid` > `.level-tile` | `__tag` ("Play"), `.stars` inside | `[data-stars="1".."3"]`/`[data-solved="true"]` (warm dark; 3★ glows) `[data-locked="true"]` (dark socket) `[data-current="true"]` (lit) `:active` `:focus-visible` |
| `.chapter` | `.eyebrow` + `__meta`; ahead: `__body`, `.glyph--dim` | `[data-locked="true"]` (one quiet row, hairline above) |
| `.glyph` | 3×3 logo of `<i>`, `--dim` | `i[data-lit="true"]` |
| `.sheet` / `.sheet-backdrop` | `__handle` `__title` `__result` (`.dim`) `__note` `__actions` | `[data-open="true"\|"false"]` (slides from translateY(100%)), `[hidden]` |
| `.notice` | slim banner with a tone dot | `[data-tone="info"\|"warn"\|"error"]` |
| `.tutorial-line` | one line of coach copy; keeps its height when `:empty` | `[data-tone="coach"\|"hint"]` (coach: `--text-md`, full contrast); `[data-coaching="true"]` ancestor hides tiers + hint |
| `.console` | `__bar` `__title` `__body` `__section` `__head` `__meta` `__content` `__row` (`--repeat`) `__count` (×12) `__kv` `__chips`/`__chip` `__cmd` `__input` | `[data-collapsed="true"]`, `__head[aria-expanded="false"]` hides the next sibling, `__row[data-tone]`, `__meta[data-tone="warn"]`, `__chip[data-up="false"]` |
| helpers | `.eyebrow` `.caption` `.display` `.muted` `.num` `.row` `.icon` (inline SVG) | |

## Board sizing (no JS)
A play board (`.board[data-n]`) gets `--board-cols`/`--board-rows` inline and square cells as big as its fit box allows:
`--fit-w`/`--fit-h` (from `cq` units of the `.board-slot` size container, capped by `--board-max`) minus padding and gaps.
A tall board (`[data-scroll="true"]`, the 5×16 Tower) fits its width instead (cells capped at `--cell-max-tall`) and scrolls
inside the fit box (`touch-action: pan-y`); its window ends mid-row so it reads as continuing. Slots under `--aim-below` (40px)
switch the board to `[data-aim="true"]`: `touch-action: none`, and `src/lib/aim.ts` presses on release with `.aim-bubble`.
Other boards (`.board` without `data-n`): `--board-size: min(100cqw, 100cqh - var(--board-chrome-y), var(--board-max))`.
`--board-chrome-y` is the height of the tiers + tutorial line that share the slot (default `chip-h + line-h + 2 gaps`).
If a slot holds only the board, set `--board-chrome-y: 0px` on it. The slot must be a grid/flex child with `min-height: 0` (as in `.screen--play`).
In short landscape (`max-height: 540px`), the slot uses `display: contents`, `.screen--play` becomes the container, and the board fills the left column.
Views set nothing else for size. `data-lit` is never delayed: the paint follows in `--dur-flip` (90ms), neighbours `--flip-stagger` (24ms) later.
Cheap motion: bloom, afterglow and the win wash are a `.cell::after` layer whose blur is painted once; only its `opacity` animates. No blur radius or shadow is ever animated.
Shell: info/warn notices are hidden on the play screen (errors show everywhere); home's scroll position is restored when it comes back.
Solve: set `data-status="solved"` and add `.board--sweep` at the same time. The 800ms sweep runs, then the cells dim. Remove the class before the next level.
