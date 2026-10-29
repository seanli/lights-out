# custom
Custom mode, "make your own board". Owns the `custom` slice (`CustomState`), renders `view.region('screen:custom')`;
uses `view`, `solver`, `rng`, optional `storage` (key `custom`: `{ version: 1, settings }`; unreadable → defaults).

- `custom:open`: refused `locked` until `progress.varietyOpen` (no progress slice = open); else `nav:go {custom}`.
- `custom:set {settings}`: merged and validated (`CustomSettingsSchema`), saved. Picking hex/cube while wired turns wired off;
  asking for wired off the square, or any invalid value, → `custom:refused bad_settings`.
- `custom:play` (also "New puzzle"): shape from the settings (square / `hexagonShape` / `cubeShape`; stuck: round(lights/12) in 1..8;
  wired: easy 3 gentle kinds, medium 4, hard 5, boss 6). Par = lights × .10/.17/.25/.33 (≥ 2), `makePuzzle()` like the levels:
  a symmetric board (`rules.json → custom.looks` in a random order, par ± 1 allowed, stuck/wiring placed to match), else
  `tangle()`; a share (`custom.tangled`) is tangled on purpose, with no symmetry; readable 1 on easy else 0, the session rng (one draw per puzzle, so replays match). Then `board:load {CUSTOM_LEVEL_ID}`, the slice
  (`playing`, played + 1, label "Square 7×7 · Stuck · Hard"), `custom:started`, `nav:go {play}`. A throw → status `error` +
  `custom:refused no_puzzle`. Measured: under 10ms on every board tried (12×20 boss: 7ms).
- Screen: `.screen-header` (`custom-back` → `nav:back`), a preview (the shape's glyph, lit more the harder; name; "49 lights · about
  8 presses"), radiogroups `[data-custom-option=grid|twist|difficulty][data-value]` (arrow keys, Home/End; Wired `aria-disabled`
  off the square with a note), steppers `[data-custom-size=cols|rows|hexSide|cubeSide] [data-step=-1|1]` + `[data-custom-value]`,
  `[data-custom-error]`, and the bar's `[data-action="custom-play"]`. Built once, repainted in place from the slice.
- Copy: `copy.json → custom`. CSS: `custom.css` (tokens only). Console: `custom.open`, `custom.play`, `custom.set cols=8 difficulty=boss`.
Delete it and nothing else breaks (home just has no Custom row).
