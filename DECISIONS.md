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
