# solved-sheet

The end-of-level sheet in `view.region('sheet:solved')`. Uses `view`, `clock`; owns no slice.

- `board:solved {levelId, moves, par}` → after `rules.json → solved-sheet.delayMs` (800, the board's sweep) emits `nav:open_sheet {sheet:'solved'}`.
  Cancelled by `levels:started`, `board:loaded`, `board:restarted`, or leaving the play screen first.
- Stars come from `progress:level_completed` for the same level; it may arrive before or after `board:solved` (both are stored, render on either).
  Without progress: moves vs par, no stars. Hint-lost stars show as outlines (`progress.scoring` gives the moves-only tier).
- Shows: eyebrow "Level N · solved", "Lights out.", `.stars--lg.stars--reveal[data-stars-earned]`, `[data-result]` "6 moves · par 5", one note (par / over par / hinted).
- `[data-action="next"]` → `levels:start {id+1}` (primary, autofocused), `replay` → `levels:start {id}`, `levels` → `nav:go {home}`.
  On the last level there is no next: "All N levels solved." when everything is solved, and "Back to the levels" is the primary action.
- The backdrop does nothing. Copy: `copy.json → solved-sheet`.

Delete it and a solve just leaves the dimmed board with its back button.
