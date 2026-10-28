# sound

Device feedback: a synthesised light switch (Web Audio) and haptic ticks (`navigator.vibrate`). Owns the `sound` slice: `{ enabled, status: 'idle' | 'ready' | 'unavailable' }`. One switch for both.

- The "Wall switch" palette, close-miked and dry: a tap is a click with a snap (filtered noise and plastic modes), a body thump, a mid "box" resonance that carries on phone speakers, and sometimes a latch tick. Switching on is brighter and higher, switching off duller and lower (`cells[index]` of `board:pressed`). The neighbours' faint ticks sit 24ms in, with the ripple.
- `synth.ts` renders every sound as samples (pure, seeded). After `levels:started` (decision 26) the AudioContext is created and the warm-up builds the sounds in ~185 short steps (`clock.setTimeout(0)`; one slice of a click or 512 win samples each): 6 takes per side first, then hint, undo, restart, stars, and the win last (at 24kHz). A tap before that builds one take on the spot.
- A tap plays one take (never the same twice in a row) through one buffer source and one gain, ±4% pitch, ±1.5dB, panned by column up to ±0.2 on any width (one shared panner per position), into one master gain.
- Undo is the off click reversed (it swells into its snap); restart a quick double flick; a hint a small glass tick. The winning tap clicks off; `board:solved` adds relays that spread with the 800ms sweep, then a warm D-major swell. A boss level (`levels:started {boss}`) builds and plays a fuller one: more relays, a low root and a ninth, same length and peak.
- Star ticks: one rising glass tick per earned star once the solved sheet is open (`nav:changed`) and `progress:level_completed` was seen, in either order, timed by `rules.json → sound.stars`. Skipped under reduced motion (the stars appear at once).
- Every number is in `rules.json → sound` (each decay is ms to −60dB; every sound has a `peakDb`, capped at −6dBFS by the schema). Haptics: tap 8ms, hint 6ms, a solve pattern; nothing for undo/restart; `ctx.report('haptics')` says when it's silent.
- `sound:set {enabled}` toggles and remembers (storage key `sound`), emits `sound:changed`, and clicks on. Default from `flags.json → sound.defaultOn`. If the browser refuses audio, status becomes `unavailable` and the game stays silent.

Uses `rng` (seeded copies: the takes are the same every session). Optional services: `storage`, `clock`, `view` (reduced motion).
