# sound

Owns the `sound` slice: `{ enabled, status: 'idle' | 'ready' | 'unavailable' }`.

- Synthesizes short pentatonic blips with Web Audio: pitch follows how many lights are on; a small chord on a solve; a chime for a hint; a soft low click for undo. No audio files.
- The AudioContext is created inside the first tap's handler, so browsers allow it. Until then status is `idle`.
- `sound:set {enabled}` toggles and remembers the choice (storage key `sound`), then emits `sound:changed`.
- Default from `flags.json → sound.defaultOn`; volume from `rules.json → sound.volume`.
- If the browser refuses audio, status becomes `unavailable`, the console shows why, and the game stays silent.

Optional service: `storage`. Delete it and the game is silent.
