# tutorial: requests

## Design system: a `.tutorial-line` component (shell, `src/shell/styles`)
What: style the coach paragraph the tutorial puts in `slot:coach` (`p.tutorial-line[data-tutorial]`).
Suggested: centred, `font: var(--fw-medium) var(--text-md)/var(--leading-body) var(--font-ui)`, `color: var(--c-text)`,
`text-wrap: balance`, `max-width: var(--app-max)`, `margin: var(--space-4) auto 0`, `padding-inline: var(--gutter)`;
the slot itself `min-height: calc(2 * var(--line-h))` so the controls below the board don't jump when the line appears or goes.
Why: modules never hard-code colours or sizes, and no component for it exists yet. Unstyled, it renders as a default `<p>`.
