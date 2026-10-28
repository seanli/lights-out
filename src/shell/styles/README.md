# Design system (`src/shell/styles`)
Import order: `fonts.css`, `tokens.css`, `components.css`. Components use tokens only. Gallery: `design/system.html` (`?play` = play screen alone).
One dark look (`color-scheme: dark`). With `prefers-reduced-motion`, all `--dur-*`, scales and pulses go to 0/1.
Fonts are bundled woff2 (Fraunces 600, Manrope 500/700, Latin only, 45 KB). ≤ ★ → render in the fallback face.

| Class | Variants / parts | States (what drives them) |
|---|---|---|
| `.app` | the single column, 480px max (880px in short landscape), safe-area gutters | `height:100%` |
| `.screen` | `.screen--play` (grid: header, stats, `.board-slot`, actions), `.screen--scroll` | `[hidden]` |
| `.screen-header` | `> button` · `__title` (`.eyebrow` + `strong`) · `__end` (right slot) | |
| `.btn` | `--primary` `--secondary` `--ghost` `--icon` `--hint` `--block` `--stack` (icon over label), `__meta` | `:hover` `:active` (scale) `:focus-visible` `:disabled` `[aria-disabled="true"]` `[aria-pressed="true"]` |
| `.board-slot` | size container holding `.play-tiers`, `.board`, `.tutorial-line` | |
| `.board` | `.board--sweep` (solve celebration; each cell needs `style="--i:<row+col>"`) | `[data-status="playing"\|"solved"]` (solved = dimmed, inert) |
| `.cell` | button per light | `[data-lit="true"\|"false"]` `[data-hint="true"]` (teal ring + dot) `[data-pointer="true"]` (tutorial ring, dashed, pulsing) `:active` `:focus-visible` |
| `.stat` | `.eyebrow` + `.stat__value`; `--end` (right-aligned), `--muted` | |
| `.chip` | `--lg` (star total), `__of`; group in `.play-tiers` | `[data-state="now"\|"lost"]` |
| `.stars` > `.star` | `.stars--xs/--md/--lg`, `.stars--reveal` (staggered fill-in) | `.star[data-state="on"\|"off"\|"lost"]` |
| `.level-grid` > `.level-tile` | `__tag` ("Play"), `.stars` inside | `[data-locked="true"]` (lock icon) `[data-current="true"]` (lit) `:active` `:focus-visible` |
| `.chapter` | `.eyebrow` + `__meta`; locked card: `__body`, `.glyph--dim` | `[data-locked="true"]` (dashed card + lock) |
| `.glyph` | 3×3 logo of `<i>`, `--dim` | `i[data-lit="true"]` |
| `.sheet` / `.sheet-backdrop` | `__handle` `__title` `__result` (`.dim`) `__note` `__actions` | `[data-open="true"\|"false"]` (slides from translateY(100%)), `[hidden]` |
| `.notice` | slim banner with a tone dot | `[data-tone="info"\|"warn"\|"error"]` |
| `.tutorial-line` | one line of coach copy; keeps its height when `:empty` | `[data-tone="coach"\|"hint"]` |
| `.console` | `__bar` `__title` `__body` `__section` `__head` `__meta` `__content` `__row` (`--repeat`) `__count` (×12) `__kv` `__chips`/`__chip` `__cmd` `__input` | `[data-collapsed="true"]`, `__head[aria-expanded="false"]` hides the next sibling, `__row[data-tone]`, `__meta[data-tone="warn"]`, `__chip[data-up="false"]` |
| helpers | `.eyebrow` `.caption` `.display` `.muted` `.num` `.row` `.icon` (inline SVG) | |

## Board sizing (no JS)
`.board { --board-size: min(100cqw, 100cqh - var(--board-chrome-y), var(--board-max)) }`, where `cq` is the `.board-slot` size container.
`--board-chrome-y` is the height of the tiers + tutorial line that share the slot (default `chip-h + line-h + 2 gaps`).
If a slot holds only the board, set `--board-chrome-y: 0px` on it. The slot must be a grid/flex child with `min-height: 0` (as in `.screen--play`).
In short landscape (`max-height: 540px`), the slot uses `display: contents`, `.screen--play` becomes the container, and the board fills the left column.
Views set nothing else. Lit changes are instant (the background swaps); only the glow fades over `--dur-glow`.
Solve: set `data-status="solved"` and add `.board--sweep` at the same time. The 800ms sweep runs, then the cells dim. Remove the class before the next level.
