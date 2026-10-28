# tutorial

Owns the `tutorial` slice: `{ status: 'idle'|'active'|'done', levelId, step, target, copyKey }`. Optional services: `solver`, `storage`, `view`.

- `board:loaded` on a level in `rules.json → tutorial.levels` that isn't finished → `active`, step 0, `target` = lowest index of `solver.solve(cells)`; emits `tutorial:step_shown {levelId, step, target}`. Any other level → `idle` (or `done` once all are finished).
- `board:pressed` while active: on the target → step+1; either way the target is recomputed from the payload cells and `step_shown` fires. The winning press (`litCount` 0) is left to `board:solved`.
- `board:undone` / `board:restarted` → re-points at the payload board (emits only if the target moved).
- `board:solved` while active → remembers the level (storage key `tutorial`: `{ done: number[] }`), emits `tutorial:finished {levelId}`.
- `tutorial:skip` → every tutorial level counts as finished.
- `copyKey` is `"<level>.<min(step, sentences-1)>"`; `copy.json → tutorial["<level>"]` is a list of sentences, the last repeats.
- The play view draws the pointer ring from `target`. This module only fills `view.region('slot:coach')` with one
  `<p class="tutorial-line" data-tutorial data-tone="coach" aria-live="polite">` (full contrast), emptied when not active.
- No solver → `target` is null; the sentence still shows. No storage → finished levels last for the session only.
- `flags.json → tutorial.enabled: false` → slice is `done`, no handlers, nothing rendered.
- Console: `tutorial.reset` forgets finished levels (and coaches the current board again if it is a tutorial level).

Delete the folder and the game plays without a coach line or pointer.
