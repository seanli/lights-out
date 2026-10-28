# variety

One board's level screen, classic included. Owns the `variety` slice (`{ room }`: the board showing) and renders
`view.region('screen:variety')`. Uses `view`. The home menu opens it; so does the solved sheet's Levels.

- `variety:open {room}`: any pack id in `levels.packs`. Unknown → `variety:refused unknown_room`; a room before `progress.varietyOpen`
  → `locked` (classic never; no progress slice = open). Otherwise writes the slice, `variety:opened {room}`, `nav:go {variety}`.
- Header: `variety-back` → `nav:back`, or `nav:go {home}` when we came from a level; title = board name, eyebrow = "5×5 · 50 levels".
- Summary: glyph + "7 of 50 solved · 18 of 150 stars"; `[data-action="guide"]` (only with a `learn` slice) → `learn:open {lessonId:
  'guide-<id>'}` for a room, `learn:open {}` for classic.
- `[data-room-view]`: classic in chapters (eyebrow + range, chapters ahead as one quiet row), a room as one grid of four columns.
  Tiles `[data-level-tile][data-level=<global id>][data-stars][data-locked][data-current]`, numbered by index. Unlock: classic
  `progress.unlockedUpTo`, rooms `progress.packs[id].unlockedUpTo`. Current = lowest open unsolved (all solved: the last played).
- Star legend under the first grid. A tile a solve unlocked (`progress:level_completed.unlocked`) powers on once when its board
  next shows; the current tile is scrolled into view. Every tap goes through an event, so replay reproduces it.
- Copy: `copy.json → variety` (board names come from the levels slice). CSS: `variety.css` (tokens only). Console: `variety.open [id]`.

Delete it and home hides its board rows (Continue still plays); the solved sheet's Levels goes to the menu.
