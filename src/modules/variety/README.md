# variety

The Variety menu. Owns the `variety` slice (`{ room: string | null }`) and renders `view.region('screen:variety')`. Uses `view`.

- `variety:open {room?}` → refused `locked` unless `progress.varietyOpen` (no progress slice = open), `unknown_room` for an id
  that isn't a room in `levels.packs`. Otherwise writes the slice, emits `variety:opened {room}` and `nav:go {variety}`.
- Room list: one `[data-room-tile][data-room][data-solved][data-stars]` per pack except classic, in order: a dot glyph of
  the room's shape (gaps empty, lit from the centre as the room is solved), `packs[].name`, "3/12" and "★ 8/36".
- Room view `[data-room-view]`: the room's levels as `.level-tile`s with global ids (`[data-level]`), numbered by index;
  locked = index > `progress.packs[room].unlockedUpTo` (inert); an open tile → `levels:start {levelId}`.
- `[data-action="variety-back"]`: room → list (`variety:open {}`); list → `nav:back`, or `nav:go {home}` when we came from play.
- Every tap goes through an event, so replay reproduces it. Room names come from the levels slice, not this copy.
- Copy: `copy.json → variety`. CSS: `variety.css` (tokens only). Console: `variety.open [room]`.

Delete it and home hides the Variety entry; the solved sheet's "Back to rooms" is refused quietly; everything else plays.
