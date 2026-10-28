# learn: requests

1. **Design system: `.board--mini`.** The mini board variant (illustration, demo and practice boards, plus the 5×5 glyph on lesson tiles and the table strips) lives in `src/modules/learn/learn.css`, tokens only. If other screens want it, lift `.board--mini`, `.cell[data-suggest="true"]` (teal ring + dot, same look as `data-hint`) and `.board--glyph` into `components.css`.
2. **Manifest: `clock` is optional.** Demos auto-play with `ctx.service('clock')`; without it they step on tap. The brief listed only `storage` as optional; no contract change needed.
3. **`data-action="learn-demo"`** (Play / Next tap / Replay on demo steps) is an extra DOM hook not listed in `src/contracts/dom.ts`. Suggest adding it under "Learn screen".
