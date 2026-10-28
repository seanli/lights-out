# custom requests

1. **Tuning into `rules.json → custom`.** The par shares (.10/.17/.25/.33, min 2), wiring per difficulty, lights per stuck light
   (12, max 8) and `maxTries` (400) sit in `TUNING` in `index.ts` because this builder could only add a copy section. Moving them
   is a lift-and-shift: give the manifest `data: { rules: <TUNING's shape as a valibot object> }` and read `ctx.data.rules`.
2. **Integration (other modules), nothing here depends on them:**
   - home-view: a Custom row → `custom:open {}`; locked (quiet line, like the rooms) until `progress.varietyOpen`.
   - play-view: for `levelId === CUSTOM_LEVEL_ID` the header reads `custom.label` and "Puzzle {custom.played}"; Back returns here
     (`nav:back`, the trail already does it).
   - solved-sheet: after a custom solve, "New puzzle" → `custom:play {}` and "Change board" → `nav:go {custom}`; no stars saved.
3. **Shell:** `view.ts` DEPTH has no `custom`, so leaving Custom for home slides "forward". Suggest `custom: 1` (beside `variety`).
4. **Contracts (`dom.ts`):** document the hooks this screen renders: `[data-screen="custom"]`, `[data-custom-group="grid|twist|difficulty"]`
   (role radiogroup) holding `[data-custom-option][data-value]` (role radio, aria-checked, Wired aria-disabled off the square),
   `[data-custom-size="cols|rows|hexSide|cubeSide"]` with `[data-step="-1|1"]` and `[data-custom-value]`, `[data-custom-preview]`,
   `[data-custom-name]`, `[data-custom-summary]`, `[data-custom-lights]`, `[data-custom-note]`, `[data-custom-wired-note]`,
   `[data-custom-error]`, `[data-action="custom-back"|"custom-play"]`.
5. **Design system:** the segmented choice (`.custom__seg` > `.custom__opt` with aria-checked / aria-disabled) and the stepper
   (`.custom__stepper`: name, − value +) are new kinds of control. If another screen needs either, they belong in `components.css`
   (e.g. `.segmented`, `.stepper`); tokens only already.
