# variety

One board's level screen, classic included. Owns the `variety` slice (`{ room }`: the board showing), renders
`view.region('screen:variety')`, uses `view`. Opened by the home menu and the solved sheet's Levels.

- `variety:open {room}`: any pack id in `levels.packs`. Unknown → `variety:refused unknown_room`; a room before `progress.varietyOpen`
  → `locked` (classic never; no progress slice = open). Otherwise writes the slice, `variety:opened {room}`, `nav:go {variety}`.
- Header: `variety-back` → `nav:back` (`nav:go {home}` after a level); title = name, eyebrow = "5×5 · 50 levels" (shapes "30 levels", `boardNotes`).
- Summary: glyph + "7 of 50 solved · 18 of 150 stars"; `[data-action="guide"]` (only with a `learn` slice) → `learn:open {lessonId:
  'guide-<id>'}` for a room, `learn:open {}` for classic.
- `[data-room-view]`: five columns on every board. Tiles run in bands (`.variety__band`) that close on a boss (`LevelDef.boss`, every
  10th: two rows of five), a little apart; classic's bands sit in its chapters (eyebrow + range, chapters ahead as one quiet row).
- Tiles `[data-level-tile][data-level=<global id>][data-stars][data-locked][data-current]` (+ `data-boss="true"` and the shared skull
  above the number, dim when locked), numbered by index; Play or stars below. Unlock: classic `progress.unlockedUpTo`, rooms
  `progress.packs[id].unlockedUpTo`. Current = lowest open unsolved (all solved: the last played). Boss labels: "Boss. Level 10, locked".
- Star legend under the first chapter. A tile a solve unlocked (`progress:level_completed.unlocked`) powers on once when its board
  next shows; the current tile is scrolled into view. Every tap goes through an event (replay reproduces it).
- Copy: `copy.json → variety` (board names come from the levels slice). CSS: `variety.css` (tokens only). Console: `variety.open [id]`.
Delete it and home hides its board rows (Continue still plays); the solved sheet's Levels goes to the menu.
