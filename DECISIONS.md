# Decisions

| # | Decision | Kind | Why |
|---|---|---|---|
| 1 | Level path: 50 numbered levels in named chapters, 1–3 stars by moves vs par, progress saved | decided with the user | Clear sense of progress for a casual phone game |
| 2 | One-tap hint highlights one correct cell; each hint costs 1★ (min 1★) | decided with the user | Unsticks players without giving the puzzle away |
| 3 | Classic 5×5 only at launch; sizes/variants later as modules | decided with the user | Keeps the first version focused |
| 4 | Must be playable offline | decided with the user | User request at approval |
| 5 | Vite 8.3 + TypeScript 7.0 + Vitest 5.0 + Valibot 1.5, single-file build (vite-plugin-singlefile 2.3.4) | lead default | Current, verified building here; single file fits the artifact host and offline use |
| 6 | Solver written in-house (GF(2) elimination, ~60 lines) | lead default | No maintained library exists; the maths is small and standard |
| 7 | Hint penalty survives Restart and reload until the level is solved | lead default | Otherwise Restart is a free way to erase the cost |
| 8 | Undo takes back a tap and doesn't count as a move; hints can't be undone | lead default | Mis-taps on a phone shouldn't cost stars |
| 9 | Levels unlock one at a time | lead default | Simple, matches the level path |
| 10 | Dark-room look only, no light theme | lead default | The glow is the game; the mockup was approved |
| 11 | Solve plays a ~0.8s sweep, then the sheet; taps during the sweep are ignored | lead default | Celebrates the win without blocking normal play |
| 12 | Debug console behind `#debug` (not `?debug`) | changed after evidence | The artifact frame passes only a plain hash, never a query string |
| 13 | Offline: zero network requests (fonts bundled via @fontsource), standalone HTML file, plus a PWA build with a hand-written service worker | lead default | Artifact pages can't register service workers; the PWA is the only way to open with no connection on a phone. The app is one file, so a 30-line worker beats Workbox |
| 14 | Hints used are counted by `progress` (from `hints:shown`), not read from the hints slice at solve time | lead default | Keeps handlers order-independent |
| 15 | Levels come from a fixed seed (rules.json → levels.seed): every player gets the same 50 boards | lead default | Stars are comparable between players; tuning is reproducible |
| 16 | Sound on by default; pentatonic blips by lit count, chord on solve, mute remembered | lead default | Tactile feedback; synthesized so nothing is downloaded |
| 17 | The progress slice carries the star rule (`scoring`) so views show tiers without owning the rule | lead default | One source of truth for the star thresholds |
| 18 | Offline version hosted on GitHub Pages (seanli/lights-out), deployed by Actions on push | decided with the user | User created the repo |
| 19 | Learn screen with 5 interactive lessons (shapes, order, chasing, bottom-row table, shortest solution) plus practice with optional assist; opened from home and the level header; back resumes the board untouched; practice never affects stars | decided with the user (form: lead default) | User asked for a place to learn pattern recognition; the bottom-row table and quiet patterns are computed from the solver so they can't be wrong |
| 20 | Page-weight target retuned from ≤150KB raw to ≤200KB raw and ≤80KB gzip | changed after evidence | The Learn screen (user request) and full copy pushed the single file to ~151KB before the last views; gzip (what actually loads) is ~63KB and boot stays well under the 800ms target. Fonts were already subset 45→26KB |
| 21 | Bottom-row table and quiet patterns are computed from the solver at startup, not written in data | lead default | They can never disagree with the game's rules |
