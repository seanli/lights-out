# offline

Owns the `offline` slice: `{ target, worker, online, reason? }`.

- Every build is offline-capable once open: nothing is fetched (fonts are bundled).
- In the PWA build (`npm run build:pwa`) it registers `./sw.js` from `scripts/pwa-finish.mjs`, so the game also *opens* with no connection. First install shows `copy.offline.ready` for 4s.
- Listens to the browser's online/offline events and shows `copy.offline.offline` while offline.
- Reports its state to the console (`offline worker`). If registration fails it says so in plain words and the game keeps working.

Optional services: `env` (which build this is), `view` (notices), `clock`. Delete it and the game still runs; only the PWA loses offline launch.
