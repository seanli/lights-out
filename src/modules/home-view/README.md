# home-view
The menu (The Good Sudoku pattern, DECISIONS #42, #45, #47). Renders `view.region('screen:home')` and `sheet:confirm_reset`. Uses `view`, optional `env`; owns no slice.

- Reads `levels` (`packs`), `progress`, `storage`, `sound`, `learn`, `variety`, `nav`; rows rebuild only when `packs` changes. Header: logo,
  title, a quiet sound icon (`sound:set`, aria-pressed), the star chip (every board's stars).
- `[data-action="continue"]` → `levels:start` for `suggest()`: the board of `save.lastLevel` (classic when unknown or locked), its lowest
  startable unsolved level; else classic's; else the first board with one; all solved → the last played level.
  Label "Start · Level 1" (fresh), "Continue · Level 7", "Continue · Ring 4". Caption "x of y solved" over the open boards,
  plus "Progress is saved on this device" at 0 solved. Until classic level 3 is solved, "New here? Learn the patterns" sits under it.
- Three `.section`s `[data-group="boards|shapes|extreme"]` (from `Pack.group`; none = by kind), quiet eyebrows from copy, empty ones
  hidden. One design-system `.menu-row` per pack: `[data-room-tile][data-room][data-solved][data-stars][data-locked]` with the shared
  `roomGlyph`, name, meta ("8×8 · 30 levels", "30 levels" for shapes, `boardNotes` by id: "6×16 · scrolls · 30 levels"),
  "solved/count" and "★ stars" → `variety:open {room}`. Rooms are locked until `progress.varietyOpen` (`aria-disabled`: dim glyph,
  "Opens after level 20", inert). Hidden without a `variety` slice.
- Learn row (a lit plus on a 5×5 glyph, `learn:open {}`) while a `learn` slice exists. Reset (`.btn--link`) → `nav:open_sheet
  {confirm_reset}` (`.btn--danger` confirms) → `progress:clear`. Logo row `--header-h`, Continue `--stack` below, sections `--stack-lg`.
- Very bottom: `[data-home-version]` "Version 0.7.0 · 28 Oct 2026" from `env.version` + `env.buildId` (UTC yyyymmddhhmm; else just the
  version); hidden without `env`. Copy: `copy.json → home-view`. Layout CSS in `home-view.css` (tokens only).
Delete it and the game opens on an empty home screen; everything else still boots.
