# storage

Wraps `localStorage` as the `storage` service (StorageService). Never throws.

- Startup check: write, read back and remove a test key. `ok` → live; anything else → `memory` with a plain reason.
- Owns the `storage` slice `{ status: 'checking'|'ok'|'memory', reason? }`; emits `storage:checked` from `start()`; reports `browser storage` (live/mock).
- Memory mode shows `copy.storage.memoryNotice` (warn notice `storage`). If the browser can still read but not write, existing saves still load.
- Keys are `${rules.storage.namespace}:${key}`, values JSON.
- `get` → parsed value or `undefined`. Unparseable text is copied (as a JSON string) to `<key>.corrupt` (then `.corrupt-2`…, never overwriting an earlier copy) and a warning is logged. The original is left in place.
- `set` → `false` when the value didn't reach the browser; it is then kept in memory for this visit (later `get`s see it).
- `mode()` → `'live'` | `'memory'`.

Delete it and modules that use storage fall back to memory (progress does).
