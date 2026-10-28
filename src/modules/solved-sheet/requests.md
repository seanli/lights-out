# solved-sheet requests

1. **Design system: delay `.stars--reveal` until the sheet has slid up.** Locally in `solved-sheet.css` each star's
   `animation-delay` adds `var(--dur-sheet)`, so the fill-in starts after the 280ms slide (0 with reduced motion).
   Proposed: a `--reveal-delay` custom property on `.stars--reveal` (default 0) that the sheet sets.
