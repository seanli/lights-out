# home-view requests

1. **Design system: a destructive button variant.** The reset confirmation needs a "this deletes things" button.
   Locally `.home__danger` (in `home-view.css`): `color: var(--c-error); background: var(--c-tone-bg-error); box-shadow: inset 0 0 0 var(--hairline) var(--c-error)`.
   Proposed: `.btn--danger` in `components.css` with the same values.
2. **Design system: a legend strip.** The home footer's star legend (`.home__legend`, `.home__legend-item`, `.home__sep`) is the mockup's `.legend`.
   Tokens only; could move to `components.css` as `.legend` if another screen needs it.
3. **Shell: the home screen's scroll box clips tile glows and focus rings at the gutters.** Worked around with
   `.screen.home { margin-inline: calc(-1 * var(--space-2)); padding-inline: var(--space-2); }`. `.screen--scroll` could do this itself.
4. **Short landscape level grid:** `.home .level-grid` goes 10 wide under `(orientation: landscape) and (max-height: 540px)` so a
   20-level chapter is two rows instead of four stretched ones. Could live in `components.css` next to `.level-grid`.
