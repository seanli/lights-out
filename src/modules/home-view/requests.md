# home-view requests

1. **Design system: a destructive button variant.** The reset confirmation needs a "this deletes things" button.
   Locally `.home__danger` (in `home-view.css`): `color: var(--c-error); background: var(--c-tone-bg-error); box-shadow: inset 0 0 0 var(--hairline) var(--c-error)`.
   Proposed: `.btn--danger` in `components.css` with the same values.
2. **Shell: scroll boxes clip glows and focus rings at the gutters.** Home works around it with
   `.screen.home { margin-inline: calc(-1 * var(--space-2)); padding-inline: var(--space-2); }` (variety uses `--gutter`). `.screen--scroll` could do this itself.
3. **Progress: record room levels in `save.lastLevel`.** Continue starts "the board last played" (dom.ts, DECISIONS #42), but
   `progress` ignores `levels:started` for room levels, so today Continue only reaches a room once classic has nothing open.
   `suggest()` already handles a room id in `lastLevel`. Change: in `progress`, drop the `pack !== 'classic'` early return.
4. **Progress: expose the rooms' gate.** The locked row reads "Opens after level 20" from copy; the 20 is `rules.json → progress.varietyAfter`.
   If the progress slice carried `varietyAfter`, the copy could be "Opens after level {level}" and never drift.
5. **`src/lib`: one board tally.** `tally(pack, progress)` (open, highest startable index, solved, stars) is the same 15 lines in
   home-view and variety (modules can't share code). Proposed `src/lib/boards.ts`.
6. **Design system: a menu row.** `.home__row` (64px, hairlines between, glyph · name + meta · score) could become `.menu-row` in components.css.
7. **Levels: say which boards scroll.** The Tower's meta reads "5×16 · scrolls · 30 levels"; the note is `copy.json → home-view.boardNotes`
   keyed by pack id (variety has the same). If `Pack` carried `note?: string` (or `scrolls?: true`, set by levels from the rule play-view
   uses), the menu and the board screen would follow the data and never drift. `metaOf()` is also duplicated in both modules (see #5).
